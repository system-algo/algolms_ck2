import { useEffect, useMemo, useState } from 'react';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import {
  loadLocalTaskState,
  saveLocalTaskState,
} from '../lib/taskExtractors.js';
import './ImageDropzonesTask.css';

const API_BASE_URL = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const SESSION_STORAGE_KEY = 'algolms_session_id';

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getTaskId(task) {
  return String(task?.id || task?.taskId || '').trim();
}

function getRuntimeIds(pageInstance) {
  let courseId = '';
  let lessonId = '';
  let pageId = '';

  try {
    const params = new URLSearchParams(window.location.search);

    courseId = params.get('course') || '';
    lessonId = params.get('lesson') || '';
    pageId = params.get('page') || '';
  } catch {
    // Ignore and use pageInstance fallback below.
  }

  return {
    courseId: courseId || pageInstance?.courseId || pageInstance?.course?.id || pageInstance?.course || '',
    lessonId: lessonId || pageInstance?.lessonId || pageInstance?.lesson?.id || pageInstance?.lesson || '',
    pageId: pageId || pageInstance?.pageId || pageInstance?.page?.id || pageInstance?.id || '',
  };
}

function getSessionId() {
  try {
    const existing = localStorage.getItem(SESSION_STORAGE_KEY);

    if (existing) return existing;

    const next =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    localStorage.setItem(SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function getStates(task) {
  return Array.isArray(task?.states) ? task.states : [];
}

function getImageSrc(image) {
  if (!image) return '';
  if (typeof image === 'string') return image;

  return (
    image.imageSrc ||
    image.localSrc ||
    image.publicSrc ||
    image.src ||
    image.url ||
    image.href ||
    ''
  );
}

function normalizeImage(image) {
  const src = getImageSrc(image);

  if (!src) return null;

  if (typeof image === 'string') {
    return {
      src,
      alt: '',
      width: 0,
      height: 0,
    };
  }

  return {
    ...image,
    src,
    alt: image.alt || image.label || image.title || '',
    width: image.naturalWidth || image.width || image.rect?.w || 0,
    height: image.naturalHeight || image.height || image.rect?.h || 0,
  };
}

function getUniqueImages(task) {
  const images = [];

  getStates(task).forEach((state) => {
    (state.images || []).forEach((image) => {
      const normalized = normalizeImage(image);

      if (!normalized?.src) return;
      if (normalized.width < 80 && normalized.height < 80) return;

      images.push(normalized);
    });
  });

  const seen = new Set();

  return images.filter((image) => {
    if (seen.has(image.src)) return false;

    seen.add(image.src);
    return true;
  });
}

function getBestImage(task) {
  const images = getUniqueImages(task);

  if (!images.length) return null;

  return [...images].sort((a, b) => {
    const areaA = Number(a.width || 0) * Number(a.height || 0);
    const areaB = Number(b.width || 0) * Number(b.height || 0);

    return areaB - areaA;
  })[0];
}

function normalizeDraggable(item, index) {
  if (typeof item === 'string') {
    return {
      id: normalizeKey(item) || `item-${index + 1}`,
      label: item,
      imageSrc: '',
    };
  }

  const label =
    item?.label ||
    item?.text ||
    item?.title ||
    item?.name ||
    item?.value ||
    `Item ${index + 1}`;

  return {
    ...item,
    id: item?.id || item?.key || normalizeKey(label) || `item-${index + 1}`,
    label,
    imageSrc:
      item?.imageSrc ||
      item?.image ||
      item?.src ||
      item?.url ||
      item?.href ||
      '',
  };
}

function normalizeDraggables(values = []) {
  return values.map(normalizeDraggable).filter((item) => item.id && item.label);
}

function normalizeDropzone(zone, index) {
  const label =
    zone?.label ||
    zone?.title ||
    zone?.name ||
    zone?.text ||
    `Dropzone ${index + 1}`;

  const accepts = Array.isArray(zone?.accepts)
    ? zone.accepts
    : [zone?.accepts || zone?.answer || zone?.itemId || zone?.correctItemId || ''];

  const id = String(zone?.id || zone?.key || `zone-${index + 1}`).trim();
  const acceptsList = accepts.filter(Boolean).map(String);

  let x = Number(zone?.x ?? zone?.left ?? 0);
  let y = Number(zone?.y ?? zone?.top ?? 0);
  let w = Number(zone?.w ?? zone?.width ?? 20);
  let h = Number(zone?.h ?? zone?.height ?? 10);

  if (id === 'zone-toolbar' || acceptsList.includes('toolbar')) {
    x = 70;
    y = 8;
    w = 26;
    h = 11;
  } else if (id === 'zone-working-window' || acceptsList.includes('working-window')) {
    x = 35;
    y = 28.5;
    w = 26.5;
    h = 12;
  } else if (id === 'zone-explorer' || acceptsList.includes('explorer')) {
    x = 66;
    y = 50;
    w = 30.5;
    h = 12.5;
  } else if (id === 'zone-toolbox' || acceptsList.includes('toolbox')) {
    x = -1;
    y = 71.5;
    w = 28.5;
    h = 14.5;
  } else if (id === 'zone-properties' || acceptsList.includes('properties')) {
    x = 52;
    y = 76;
    w = 30.5;
    h = 13.5;
  }

  return {
    ...zone,
    id,
    label,
    accepts: acceptsList,
    x,
    y,
    w,
    h,
  };
}

function normalizeDropzones(values = []) {
  return values.map(normalizeDropzone).filter((zone) => zone.id);
}

function findItemByLabel(draggables, label) {
  const key = normalizeKey(label);
  return draggables.find((item) => normalizeKey(item.label) === key);
}

function buildDefaultDropzones(draggables) {
  const toolbar = findItemByLabel(draggables, 'Toolbar');
  const toolbox = findItemByLabel(draggables, 'Toolbox');
  const explorer = findItemByLabel(draggables, 'Explorer');
  const workingWindow = findItemByLabel(draggables, 'Working window');
  const properties = findItemByLabel(draggables, 'Properties');

  const play = findItemByLabel(draggables, 'Play');
  const color = findItemByLabel(draggables, 'Color');
  const scale = findItemByLabel(draggables, 'Scale');
  const move = findItemByLabel(draggables, 'Move');

  const zones = [];

  if (toolbar) {
    zones.push({
      id: 'zone-toolbar',
      label: 'Toolbar',
      accepts: [toolbar.id],
      x: 70,
      y: 8,
      w: 26,
      h: 11,
    });
  }

  if (workingWindow) {
    zones.push({
      id: 'zone-working-window',
      label: 'Working window',
      accepts: [workingWindow.id],
      x: 35,
      y: 28.5,
      w: 26,
      h: 12,
    });
  }

  if (explorer) {
    zones.push({
      id: 'zone-explorer',
      label: 'Explorer',
      accepts: [explorer.id],
      x: 67,
      y: 48,
      w: 30,
      h: 11,
    });
  }

  if (toolbox) {
    zones.push({
      id: 'zone-toolbox',
      label: 'Toolbox',
      accepts: [toolbox.id],
      x: -1.5,
      y: 62,
      w: 28,
      h: 14,
    });
  }

  if (properties) {
    zones.push({
      id: 'zone-properties',
      label: 'Properties',
      accepts: [properties.id],
      x: 52,
      y: 72,
      w: 30.5,
      h: 13,
    });
  }

  if (play) {
    zones.push({
      id: 'zone-play',
      label: 'Play',
      accepts: [play.id],
      x: 7,
      y: 12,
      w: 13,
      h: 18,
    });
  }

  if (color) {
    zones.push({
      id: 'zone-color',
      label: 'Color',
      accepts: [color.id],
      x: 7,
      y: 43,
      w: 13,
      h: 18,
    });
  }

  if (scale) {
    zones.push({
      id: 'zone-scale',
      label: 'Scale',
      accepts: [scale.id],
      x: 64,
      y: 12,
      w: 6,
      h: 12,
    });
  }

  if (move) {
    zones.push({
      id: 'zone-move',
      label: 'Move',
      accepts: [move.id],
      x: 72,
      y: 12,
      w: 6,
      h: 12,
    });
  }

  return zones;
}

function getConfigFromTask(task) {
  if (task?.imageDropzones) return task.imageDropzones;
  if (task?.diagramDropzones) return task.diagramDropzones;
  if (task?.renderer?.imageDropzones) return task.renderer.imageDropzones;
  if (task?.renderer?.diagramDropzones) return task.renderer.diagramDropzones;

  if (task?.matchingDragdrop?.mode === 'image-drop') {
    return task.matchingDragdrop;
  }

  if (task?.renderer?.matchingDragdrop?.mode === 'image-drop') {
    return task.renderer.matchingDragdrop;
  }

  return {};
}

function getConfiguredImage(config, task) {
  const manualImage =
    config.backgroundImage ||
    config.image ||
    config.background ||
    config.src ||
    '';

  const normalized = normalizeImage(manualImage);

  if (normalized?.src) return normalized;

  return getBestImage(task);
}

function buildData(task) {
  const config = getConfigFromTask(task);

  const title =
    config.title ||
    config.prompt ||
    '';

  const prompt =
    config.prompt ||
    config.question ||
    task?.question ||
    title;

  const draggables = normalizeDraggables(
    config.draggables ||
    config.items ||
    config.choices ||
    [],
  );

  const configuredDropzones = normalizeDropzones(
    config.dropzones ||
    config.zones ||
    config.targets ||
    [],
  );

  const dropzones = configuredDropzones.length
    ? configuredDropzones
    : buildDefaultDropzones(draggables);

  return {
    title,
    prompt,
    helperText: config.helperText || '',
    image: getConfiguredImage(config, task),
    draggables,
    dropzones,
    variant: config.variant || '',
  };
}

function isPlacementCorrect(zone, itemId) {
  if (!itemId) return false;

  return zone.accepts.includes(itemId);
}

function getInitialPlacements(dropzones) {
  return dropzones.reduce((acc, zone) => {
    acc[zone.id] = '';
    return acc;
  }, {});
}

function removeItemFromPlacements(placements, itemId) {
  const next = { ...placements };

  Object.entries(next).forEach(([zoneId, value]) => {
    if (value === itemId) {
      next[zoneId] = '';
    }
  });

  return next;
}

function renderItemContent(item, imageClassName) {
  if (!item) return null;

  if (item.imageSrc) {
    return (
      <img
        className={imageClassName}
        src={item.imageSrc}
        alt={item.label}
        draggable={false}
      />
    );
  }

  return item.label;
}

function sanitizePlacements(rawPlacements, dropzones, draggables) {
  const initial = getInitialPlacements(dropzones);
  if (!rawPlacements || typeof rawPlacements !== 'object') return initial;

  const validZoneIds = new Set(dropzones.map((z) => z.id));
  const validItemIds = new Set(draggables.map((d) => d.id));

  const result = { ...initial };

  Object.entries(rawPlacements).forEach(([zoneId, itemId]) => {
    if (validZoneIds.has(zoneId) && validItemIds.has(itemId)) {
      result[zoneId] = itemId;
    }
  });

  return result;
}

export default function ImageDropzonesTask({
  task,
  pageInstance,
  onPrevTask,
  onNextTask,
  isTaskDone,
}) {
  const taskId = getTaskId(task);

  const data = useMemo(() => buildData(task), [task]);

  const [selectedItemId, setSelectedItemId] = useState('');
  const [placements, setPlacements] = useState(() => {
    const saved = loadLocalTaskState(taskId, null);
    return sanitizePlacements(saved?.placements, data.dropzones, data.draggables);
  });
  const [status, setStatus] = useState(() => {
    const saved = loadLocalTaskState(taskId, null);
    return saved?.status || '';
  });
  const [checked, setChecked] = useState(() => {
    const saved = loadLocalTaskState(taskId, null);
    return Boolean(saved?.checked);
  });
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const saved = loadLocalTaskState(taskId, null);

    setPlacements(sanitizePlacements(saved?.placements, data.dropzones, data.draggables));
    setStatus(saved?.status || '');
    setChecked(Boolean(saved?.checked));
    setSelectedItemId('');
    setChecking(false);
  }, [taskId, data.dropzones, data.draggables]);

  useEffect(() => {
    saveLocalTaskState(taskId, {
      placements,
      status,
      checked,
    });
  }, [taskId, placements, status, checked]);

  const placedItemIds = useMemo(
    () => new Set(Object.values(placements).filter(Boolean)),
    [placements],
  );

  const availableItems = data.draggables.filter((item) => !placedItemIds.has(item.id));

  function placeItem(zoneId, itemId) {
    if (!zoneId || !itemId || checking) return;

    setPlacements((current) => {
      const withoutItem = removeItemFromPlacements(current, itemId);

      return {
        ...withoutItem,
        [zoneId]: itemId,
      };
    });

    setSelectedItemId('');
    setStatus('');
    setChecked(false);
  }

  function clearZone(zoneId) {
    if (checking) return;

    setPlacements((current) => ({
      ...current,
      [zoneId]: '',
    }));
    setStatus('');
    setChecked(false);
  }

  function handleDrop(event, zoneId) {
    event.preventDefault();

    if (checking) return;

    const itemId = event.dataTransfer.getData('text/plain');

    placeItem(zoneId, itemId);
  }

  function handleDragStart(event, itemId) {
    event.dataTransfer.setData('text/plain', itemId);
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleZoneClick(zoneId) {
    if (!selectedItemId || checking) return;

    placeItem(zoneId, selectedItemId);
  }

  function resetTask() {
    if (checking) return;

    setPlacements(getInitialPlacements(data.dropzones));
    setSelectedItemId('');
    setStatus('');
    setChecked(false);
  }

  async function submitAttemptToBackend() {
    if (!API_BASE_URL) return null;

    const { courseId, lessonId, pageId } = getRuntimeIds(pageInstance);

    if (!courseId || !lessonId || !pageId || !taskId) {
      throw new Error('Missing courseId, lessonId, pageId, or taskId.');
    }

    const response = await fetch(`${API_BASE_URL}/api/activity-attempts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: getSessionId(),
        courseId,
        lessonId,
        pageId,
        taskId,
        activityType: 'image-dropzones-task',
        answer: {
          placements,
        },
      }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error?.message || 'Could not submit answer.');
    }

    return payload;
  }

  function triggerSuccess() {
    window.dispatchEvent(
      new CustomEvent('LMS_TASK_COMPLETED', {
        detail: { taskId: task?.id || task?.taskId },
      })
    );

    if (onNextTask) {
      setTimeout(onNextTask, 1000);
    }
  }

  async function checkTask() {
    const hasAllAnswers = data.dropzones.every((zone) => placements[zone.id]);

    if (!hasAllAnswers) {
      setChecked(true);
      setStatus('Try again');
      return;
    }

    setChecking(true);
    setStatus('Checking...');

    try {
      const payload = await submitAttemptToBackend();

      const allCorrect = data.dropzones.every((zone) => {
        const itemId = placements[zone.id];
        return isPlacementCorrect(zone, itemId);
      });

      if (!payload) {
        setChecked(true);
        setStatus(allCorrect ? 'Correct!' : 'Try again');
        if (allCorrect) {
          triggerSuccess();
        }
        return;
      }

      const result = payload.result || payload.attempt?.result || {};

      setChecked(true);

      if (result.isCorrect === true || payload.attempt?.isCorrect === true || allCorrect) {
        setStatus('Correct!');
        triggerSuccess();
        return;
      }

      if (result.status === 'missing_answer_key') {
        setStatus('Answer saved.');
        if (allCorrect) {
          triggerSuccess();
        }
        return;
      }

      if (result.status === 'incomplete') {
        setStatus('Try again');
        return;
      }

      if (result.feedback || payload.attempt?.feedback) {
        setStatus(result.feedback || payload.attempt.feedback);
        return;
      }

      setStatus('Try again');
    } catch (error) {
      console.error('[IMAGE_DROPZONES_SUBMIT_ERROR]', error);

      const allCorrect = data.dropzones.every((zone) => {
        const itemId = placements[zone.id];
        return isPlacementCorrect(zone, itemId);
      });

      setChecked(true);
      setStatus(allCorrect ? 'Correct!' : 'Try again');
      if (allCorrect) {
        triggerSuccess();
      }
    } finally {
      setChecking(false);
    }
  }

  function getItemById(itemId) {
    return data.draggables.find((item) => item.id === itemId) || null;
  }

  return (
    <LmsActivityFrame
      title={data.title}
      status={status}
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
      onCheck={checkTask}
      onReset={resetTask}
      isCheckDisabled={checking}
      isResetDisabled={checking}
      isCheckLoading={checking}
      isTaskDone={isTaskDone}
    >
      <article className={`image-dropzones-task ${data.variant ? `is-${data.variant}` : ''}`}>
        <section className="image-dropzones-card">


          <h1 className="image-dropzones-title">{data.prompt}</h1>

          {data.helperText && (
            <p className="image-dropzones-helper">{data.helperText}</p>
          )}

          <div className="image-dropzones-layout">
            <aside className="image-dropzones-sidebar">
              {availableItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`image-dropzones-draggable${
                    selectedItemId === item.id ? ' is-selected' : ''
                  }${item.imageSrc ? ' has-image' : ''}`}
                  draggable={!checking}
                  disabled={checking}
                  onClick={() => {
                    if (checking) return;
                    setSelectedItemId((current) => (current === item.id ? '' : item.id));
                  }}
                  onDragStart={(event) => handleDragStart(event, item.id)}
                  title={item.label}
                >
                  {renderItemContent(item, 'image-dropzones-draggable-image')}
                </button>
              ))}

              {!availableItems.length && (
                <div className="image-dropzones-empty">
                  All answers placed
                </div>
              )}
            </aside>

            <div className="image-dropzones-image-area">
              {data.image?.src ? (
                <div className="image-dropzones-image-shell">
                  <img
                    className="image-dropzones-image"
                    src={data.image.src}
                    alt={data.image.alt || ''}
                    draggable={false}
                  />

                  {data.dropzones.map((zone) => {
                    const placedItem = getItemById(placements[zone.id]);

                    return (
                      <button
                        key={zone.id}
                        type="button"
                        className={[
                          'image-dropzones-zone',
                          placedItem ? 'has-item' : '',
                          placedItem?.imageSrc ? 'has-image-item' : '',
                          selectedItemId ? 'is-ready' : '',
                        ].filter(Boolean).join(' ')}
                        style={{
                          left: `${zone.x}%`,
                          top: `${zone.y}%`,
                          width: `${zone.w}%`,
                          height: `${zone.h}%`,
                        }}
                        onClick={() => handleZoneClick(zone.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => handleDrop(event, zone.id)}
                        disabled={checking}
                      >
                        {placedItem ? (
                          <span
                            className="image-dropzones-placed"
                            draggable={!checking}
                            onDragStart={(event) => handleDragStart(event, placedItem.id)}
                          >
                            {renderItemContent(placedItem, 'image-dropzones-placed-image')}
                          </span>
                        ) : (
                          <span className="image-dropzones-zone-placeholder">
                            Drop here
                          </span>
                        )}

                        {placedItem && (
                          <span
                            role="button"
                            tabIndex={0}
                            className="image-dropzones-clear"
                            onClick={(event) => {
                              event.stopPropagation();
                              clearZone(zone.id);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                clearZone(zone.id);
                              }
                            }}
                          >
                            ×
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="image-dropzones-no-image">
                  No background image found.
                </div>
              )}
            </div>
          </div>
        </section>
      </article>
    </LmsActivityFrame>
  );
}