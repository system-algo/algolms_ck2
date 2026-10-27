import { useEffect, useMemo, useRef, useState } from 'react';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import { loadLocalTaskState, saveLocalTaskState } from '../lib/taskExtractors.js';
import {
  getTaskId,
  notifyTaskCompleted,
  submitGradedAttempt,
  useManualTaskConfig,
} from '../lib/ck2TaskRuntime.js';
import './CanvasDropTask.css';

/**
 * CanvasDropTask — the "coordinate grid" steps of the real platform (math-coordinate-grid).
 *
 * The author places static pictures, draggable pictures / words, drop cells and
 * numeric circles by pixel position inside a fixed workspace (920x400 or 920x205).
 * This component renders that same workspace, scaled to fit the card, so the
 * layout stays as close as possible to the real lesson.
 *
 * Map config (tasks[taskId].canvasDrop):
 * {
 *   title, workspace: { width, height },
 *   statics:    [{ id, src, x, y, w, h }],
 *   labels:     [{ id, text, x, y, w, h }],
 *   zones:      [{ id, name, x, y, w, h, answer }],            // answer = draggable id
 *   draggables: [{ id, src?, text?, x, y, w, h, alt? }],        // x,y = home position
 *   inputs:     [{ id, name, x, y, answer }]                    // optional numeric circles
 * }
 *
 * Backend contract (same as image-dropzones-task):
 *   answer = { placements: { [zone.name]: draggable.id }, inputs?: { [input.name]: "9" } }
 */

const ACTIVITY_TYPE = 'image-dropzones-task';
const DRAG_THRESHOLD_PX = 4;

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeConfig(raw) {
  const config = raw || {};
  const workspace = {
    width: asNumber(config.workspace?.width, 920),
    height: asNumber(config.workspace?.height, 400),
  };

  const rect = (item) => ({
    x: asNumber(item.x),
    y: asNumber(item.y),
    w: asNumber(item.w),
    h: asNumber(item.h),
  });

  return {
    title: String(config.title || '').trim(),
    workspace,
    statics: (config.statics || []).map((item, index) => ({
      ...item,
      id: String(item.id || `static-${index + 1}`),
      ...rect(item),
    })),
    labels: (config.labels || []).map((item, index) => ({
      ...item,
      id: String(item.id || `label-${index + 1}`),
      ...rect(item),
    })),
    zones: (config.zones || []).map((item, index) => ({
      ...item,
      id: String(item.id || item.name || `zone-${index + 1}`),
      name: String(item.name || item.id || `zone-${index + 1}`),
      answer: String(item.answer ?? ''),
      ...rect(item),
    })),
    draggables: (config.draggables || []).map((item, index) => ({
      ...item,
      id: String(item.id || `item-${index + 1}`),
      ...rect(item),
    })),
    inputs: (config.inputs || []).map((item, index) => ({
      ...item,
      id: String(item.id || item.name || `input-${index + 1}`),
      name: String(item.name || item.id || `input-${index + 1}`),
      answer: String(item.answer ?? '').trim(),
      x: asNumber(item.x),
      y: asNumber(item.y),
    })),
  };
}

/** Size an item so it fits its drop zone (keeps the picture's proportions). */
function fitIntoZone(item, zone) {
  const ratio = Math.min(zone.w / Math.max(item.w, 1), zone.h / Math.max(item.h, 1));
  const w = Math.max(1, item.w * ratio);
  const h = Math.max(1, item.h * ratio);
  return { x: zone.x + (zone.w - w) / 2, y: zone.y + (zone.h - h) / 2, w, h };
}

function sanitizePlacements(raw, zones, draggables) {
  const validZones = new Set(zones.map((z) => z.id));
  const validItems = new Set(draggables.map((d) => d.id));
  const used = new Set();
  const next = {};

  zones.forEach((zone) => {
    next[zone.id] = '';
  });

  Object.entries(raw || {}).forEach(([zoneId, itemId]) => {
    if (validZones.has(zoneId) && validItems.has(itemId) && !used.has(itemId)) {
      next[zoneId] = itemId;
      used.add(itemId);
    }
  });

  return next;
}

export default function CanvasDropTask({
  task,
  pageInstance,
  onPrevTask,
  onNextTask,
  onTaskCompleted,
  onTaskComplete,
  isTaskDone = false,
}) {
  const taskId = getTaskId(task);
  const storageKey = `canvas-drop-${taskId}`;

  const rawConfig = useManualTaskConfig(task, pageInstance, ['canvasDrop']) || task?.canvasDrop || null;
  const data = useMemo(() => normalizeConfig(rawConfig), [rawConfig]);
  const { workspace, zones, draggables, inputs } = data;
  const hasData = zones.length > 0 && draggables.length > 0;

  const solvedPlacements = useMemo(() => {
    const full = {};
    zones.forEach((zone) => {
      full[zone.id] = zone.answer;
    });
    return full;
  }, [zones]);

  const solvedInputs = useMemo(() => {
    const full = {};
    inputs.forEach((input) => {
      full[input.name] = input.answer;
    });
    return full;
  }, [inputs]);

  const [placements, setPlacements] = useState({});
  const [inputValues, setInputValues] = useState({});
  const [drag, setDrag] = useState(null); // { id, x, y, moved }
  const [hoverZoneId, setHoverZoneId] = useState('');
  const [status, setStatus] = useState('');
  const [hasError, setHasError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [scale, setScale] = useState(1);

  const fitRef = useRef(null);
  const workspaceRef = useRef(null);
  const dragRef = useRef(null);

  const isSolved = Boolean(isTaskDone || confirmed);

  // Load saved or solved state once the config is available.
  useEffect(() => {
    if (!hasData) return;

    if (isTaskDone) {
      setPlacements(solvedPlacements);
      setInputValues(solvedInputs);
      return;
    }

    const saved = loadLocalTaskState(storageKey, null);
    setPlacements(sanitizePlacements(saved?.placements, zones, draggables));
    setInputValues(saved?.inputs && typeof saved.inputs === 'object' ? saved.inputs : {});
  }, [hasData, isTaskDone, storageKey, zones, draggables, solvedPlacements, solvedInputs]);

  useEffect(() => {
    if (!hasData || isSolved) return;
    saveLocalTaskState(storageKey, { placements, inputs: inputValues });
  }, [hasData, isSolved, storageKey, placements, inputValues]);

  // Scale the fixed-size workspace to the card width.
  useEffect(() => {
    const element = fitRef.current;
    if (!element) return undefined;

    const update = () => {
      const available = element.clientWidth || workspace.width;
      setScale(Math.min(1, available / workspace.width));
    };

    update();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [workspace.width, hasData]);

  const itemById = useMemo(() => {
    const map = new Map();
    draggables.forEach((item) => map.set(item.id, item));
    return map;
  }, [draggables]);

  const zoneOfItem = useMemo(() => {
    const map = {};
    Object.entries(placements).forEach(([zoneId, itemId]) => {
      if (itemId) map[itemId] = zoneId;
    });
    return map;
  }, [placements]);

  function toWorkspacePoint(event) {
    const box = workspaceRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: (event.clientX - box.left) / scale, y: (event.clientY - box.top) / scale };
  }

  function findZoneAt(point) {
    return zones.find(
      (zone) => point.x >= zone.x && point.x <= zone.x + zone.w && point.y >= zone.y && point.y <= zone.y + zone.h,
    );
  }

  function handlePointerDown(event, item) {
    if (isSolved || checking) return;
    if (event.button !== undefined && event.button !== 0) return;

    const point = toWorkspacePoint(event);
    const current = zoneOfItem[item.id]
      ? fitIntoZone(item, zones.find((z) => z.id === zoneOfItem[item.id]))
      : { x: item.x, y: item.y, w: item.w, h: item.h };

    dragRef.current = {
      id: item.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      offsetX: point.x - current.x,
      offsetY: point.y - current.y,
      size: { w: current.w, h: current.h },
      moved: false,
    };

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional.
    }

    event.preventDefault();
  }

  function handlePointerMove(event) {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;

    const dx = event.clientX - state.startClientX;
    const dy = event.clientY - state.startClientY;
    if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    state.moved = true;

    const point = toWorkspacePoint(event);
    setDrag({
      id: state.id,
      x: point.x - state.offsetX,
      y: point.y - state.offsetY,
      w: state.size.w,
      h: state.size.h,
    });
    setHoverZoneId(findZoneAt(point)?.id || '');
    setStatus('');
    setHasError(false);
  }

  function handlePointerUp(event) {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;

    dragRef.current = null;
    setDrag(null);
    setHoverZoneId('');

    if (!state.moved) return;

    const point = toWorkspacePoint(event);
    const target = findZoneAt(point);
    const fromZoneId = zoneOfItem[state.id] || '';

    setPlacements((current) => {
      const next = { ...current };

      if (!target) {
        // Dropped on empty space: the piece goes back to its starting place.
        if (fromZoneId) next[fromZoneId] = '';
        return next;
      }

      const occupant = next[target.id];
      if (fromZoneId) next[fromZoneId] = occupant && occupant !== state.id ? occupant : '';
      next[target.id] = state.id;
      return next;
    });
  }

  function handleInput(name, value) {
    if (isSolved || checking) return;
    const cleaned = String(value).replace(/[^0-9]/g, '').slice(0, 3);
    setInputValues((current) => ({ ...current, [name]: cleaned }));
    setStatus('');
    setHasError(false);
  }

  function resetTask() {
    if (checking || isSolved) return;
    setPlacements(sanitizePlacements({}, zones, draggables));
    setInputValues({});
    setStatus('');
    setHasError(false);
  }

  async function checkTask() {
    if (checking || isSolved || !hasData) return;

    const missingPieces = zones.filter((zone) => !placements[zone.id]).length;
    if (missingPieces > 0) {
      setStatus(`Please place all pieces first (${zones.length - missingPieces}/${zones.length})`);
      setHasError(true);
      return;
    }

    const missingInputs = inputs.filter((input) => !String(inputValues[input.name] || '').trim()).length;
    if (missingInputs > 0) {
      setStatus('Please complete all the numbers first');
      setHasError(true);
      return;
    }

    const piecesRight = zones.every((zone) => placements[zone.id] === zone.answer);
    const numbersRight = inputs.every(
      (input) => String(inputValues[input.name] || '').trim() === input.answer,
    );

    if (!piecesRight || !numbersRight) {
      setStatus('Almost there! Try again.');
      setHasError(true);
      return;
    }

    setChecking(true);
    setStatus('Saving your answer...');
    setHasError(false);

    const answer = {
      placements: Object.fromEntries(zones.map((zone) => [zone.name, placements[zone.id]])),
    };
    if (inputs.length) {
      answer.inputs = Object.fromEntries(inputs.map((input) => [input.name, String(inputValues[input.name]).trim()]));
    }

    try {
      // Only the backend result confirms that the answer was saved and graded.
      await submitGradedAttempt({ task, pageInstance, activityType: ACTIVITY_TYPE, answer });
      setConfirmed(true);
      setStatus('Correct!');
      notifyTaskCompleted({
        task,
        pageInstance,
        activityType: ACTIVITY_TYPE,
        metadata: answer,
        onTaskCompleted,
        onTaskComplete,
        onNextTask,
      });
    } catch (error) {
      console.warn('[CanvasDropTask] Could not save CK2 answer:', error);
      setStatus('Could not save or verify your answer. Please try again.');
      setHasError(true);
    } finally {
      setChecking(false);
    }
  }

  function renderItem(item) {
    const zoneId = zoneOfItem[item.id];
    const isDragging = drag?.id === item.id;
    const zone = zoneId ? zones.find((z) => z.id === zoneId) : null;

    let box = { x: item.x, y: item.y, w: item.w, h: item.h };
    if (zone) box = fitIntoZone(item, zone);
    if (isDragging) box = { x: drag.x, y: drag.y, w: drag.w, h: drag.h };

    return (
      <div
        key={item.id}
        className={[
          'canvas-drop-item',
          item.text ? 'is-text' : '',
          zone ? 'is-placed' : '',
          isDragging ? 'is-dragging' : '',
          isSolved ? 'is-locked' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          fontSize: item.fontSize ? `${item.fontSize}px` : undefined,
        }}
        onPointerDown={(event) => handlePointerDown(event, item)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        role="button"
        tabIndex={isSolved ? -1 : 0}
        aria-label={item.alt || item.text || `Piece ${item.id}`}
      >
        {item.text ? (
          <span>{item.text}</span>
        ) : (
          <img src={item.src} alt={item.alt || ''} draggable={false} />
        )}
      </div>
    );
  }

  return (
    <LmsActivityFrame
      title={data.title}
      status={status}
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
      onCheck={checkTask}
      onReset={resetTask}
      isCheckDisabled={checking || isSolved}
      isResetDisabled={checking || isSolved}
      isCheckLoading={checking}
      isTaskDone={isSolved}
    >
      <article className="canvas-drop-task">
        <header className="canvas-drop-header">
          <h1 className={`canvas-drop-title ${isSolved ? 'is-solved' : ''}`}>
            {isSolved && <span className="canvas-drop-check-badge">✓</span>}
            {data.title}
          </h1>
        </header>

        {!hasData ? (
          <div className="canvas-drop-empty">This activity is not set up yet.</div>
        ) : (
          <div
            ref={fitRef}
            className="canvas-drop-fit"
            style={{ height: workspace.height * scale }}
          >
            <div
              ref={workspaceRef}
              className="canvas-drop-workspace"
              style={{
                width: workspace.width,
                height: workspace.height,
                transform: `scale(${scale})`,
              }}
            >
              {data.statics.map((item) => (
                <img
                  key={item.id}
                  className="canvas-drop-static"
                  src={item.src}
                  alt={item.alt || ''}
                  draggable={false}
                  style={{ left: item.x, top: item.y, width: item.w, height: item.h }}
                />
              ))}

              {data.labels.map((item) => (
                <div
                  key={item.id}
                  className="canvas-drop-label"
                  style={{ left: item.x, top: item.y, width: item.w, height: item.h }}
                >
                  {item.text}
                </div>
              ))}

              {zones.map((zone) => {
                const filled = Boolean(placements[zone.id]);
                const isRight = isSolved || (hasError && filled && placements[zone.id] === zone.answer);
                const isWrong = hasError && filled && placements[zone.id] !== zone.answer;
                return (
                  <div
                    key={zone.id}
                    className={[
                      'canvas-drop-zone',
                      filled ? 'is-filled' : '',
                      hoverZoneId === zone.id ? 'is-hover' : '',
                      isRight ? 'is-right' : '',
                      isWrong ? 'is-wrong' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ left: zone.x, top: zone.y, width: zone.w, height: zone.h }}
                    aria-label={`Drop zone ${zone.name}`}
                  />
                );
              })}

              {inputs.map((input) => (
                <input
                  key={input.id}
                  className={`canvas-drop-input ${isSolved ? 'is-solved' : ''}`}
                  style={{ left: input.x, top: input.y }}
                  value={inputValues[input.name] || ''}
                  onChange={(event) => handleInput(input.name, event.target.value)}
                  inputMode="numeric"
                  maxLength={3}
                  disabled={isSolved || checking}
                  aria-label={`Number ${input.name}`}
                />
              ))}

              {draggables.map(renderItem)}
            </div>
          </div>
        )}
      </article>
    </LmsActivityFrame>
  );
}
