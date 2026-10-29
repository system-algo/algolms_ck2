import { useEffect, useMemo, useRef, useState } from 'react';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import { loadLocalTaskState, saveLocalTaskState } from '../lib/taskExtractors.js';
import {
  getTaskId,
  notifyTaskCompleted,
  submitGradedAttempt,
  useManualTaskConfig,
} from '../lib/ck2TaskRuntime.js';
import './CategoryDragTask.css';

/**
 * CategoryDragTask — the "categorization" steps of the real platform (math-categorization).
 * Every picture/word is unique: dragging it into a category places it into the target slot.
 *
 * Map config (tasks[taskId].categoryDrag):
 * {
 *   title, instruction?, attempt?, layout: 'top' | 'side', referenceImage?,
 *   items:      [{ id, src?, text?, alt?, w?, h? }],
 *   categories: [{ id, title?, imageSrc?, capacity?, answer: [itemId, ...] }]
 * }
 *
 * Backend contract (same as scene-classification-task):
 *   answer = { assignments: { [category.id]: [item.id, ...] } }
 */

const ACTIVITY_TYPE = 'scene-classification-task';
const DRAG_THRESHOLD_PX = 4;

function normalizeConfig(raw) {
  const config = raw || {};
  const refImg =
    config.referenceImage ||
    config.sampleImage ||
    config.imageSrc ||
    config.image ||
    (Array.isArray(config.images) && config.images[0]?.src) ||
    '';
  return {
    title: String(config.title || '').trim(),
    instruction: String(config.instruction || config.helperText || '').trim(),
    attempt: String(config.attempt || 'Attempt: 1/2').trim(),
    layout: config.layout === 'side' ? 'side' : 'top',
    referenceImage: typeof refImg === 'string' ? refImg : refImg?.src || '',
    items: (config.items || []).map((item, index) => ({ ...item, id: String(item.id || `item-${index + 1}`) })),
    categories: (config.categories || []).map((cat, index) => ({
      ...cat,
      id: String(cat.id || `cat-${index + 1}`),
      answer: (cat.answer || []).map(String),
    })),
  };
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((id) => set.has(id));
}

function sanitizeAssignments(raw, categories, items) {
  const validItems = new Set(items.map((item) => item.id));
  const used = new Set();
  const next = {};
  categories.forEach((cat) => {
    next[cat.id] = [];
  });
  Object.entries(raw || {}).forEach(([catId, ids]) => {
    if (!next[catId] || !Array.isArray(ids)) return;
    ids.forEach((id) => {
      if (validItems.has(id) && !used.has(id)) {
        next[catId].push(id);
        used.add(id);
      }
    });
  });
  return next;
}

export default function CategoryDragTask({
  task,
  pageInstance,
  onPrevTask,
  onNextTask,
  onTaskCompleted,
  onTaskComplete,
  isTaskDone = false,
}) {
  const taskId = getTaskId(task);
  const storageKey = `category-drag-${taskId}`;

  const rawConfig = useManualTaskConfig(task, pageInstance, ['categoryDrag']) || task?.categoryDrag || null;
  const data = useMemo(() => normalizeConfig(rawConfig), [rawConfig]);
  const { items, categories } = data;
  const hasData = items.length > 0 && categories.length > 0;

  const solvedAssignments = useMemo(() => {
    const full = {};
    categories.forEach((cat) => {
      full[cat.id] = [...cat.answer];
    });
    return full;
  }, [categories]);

  const [assignments, setAssignments] = useState({});
  const [drag, setDrag] = useState(null); // { id, x, y, w, h }
  const [hoverTarget, setHoverTarget] = useState('');
  const [status, setStatus] = useState('');
  const [hasError, setHasError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const dragRef = useRef(null);
  const isSolved = Boolean(isTaskDone || confirmed);

  useEffect(() => {
    if (!hasData) return;
    if (isTaskDone) {
      setAssignments(solvedAssignments);
      return;
    }
    const saved = loadLocalTaskState(storageKey, null);
    setAssignments(sanitizeAssignments(saved?.assignments, categories, items));
  }, [hasData, isTaskDone, storageKey, categories, items, solvedAssignments]);

  useEffect(() => {
    if (!hasData || isSolved) return;
    saveLocalTaskState(storageKey, { assignments });
  }, [hasData, isSolved, storageKey, assignments]);

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const placedIds = useMemo(() => {
    const set = new Set();
    Object.values(assignments).forEach((ids) => (ids || []).forEach((id) => set.add(id)));
    return set;
  }, [assignments]);

  const poolItems = items.filter((item) => !placedIds.has(item.id));

  function targetAt(clientX, clientY) {
    const element = document.elementFromPoint(clientX, clientY);
    const node = element?.closest?.('[data-drop-target]');
    return node ? node.getAttribute('data-drop-target') : '';
  }

  function handlePointerDown(event, item, inCategory = false) {
    if (isSolved || checking) return;
    if (event.button !== undefined && event.button !== 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      id: item.id,
      inCategory,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - box.left,
      offsetY: event.clientY - box.top,
      width: box.width,
      height: box.height,
      moved: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // optional
    }
    event.preventDefault();
  }

  function handlePointerMove(event) {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (!state.moved && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < DRAG_THRESHOLD_PX) {
      return;
    }
    state.moved = true;
    setDrag({
      id: state.id,
      x: event.clientX - state.offsetX,
      y: event.clientY - state.offsetY,
      w: state.width,
      h: state.height,
    });
    setHoverTarget(targetAt(event.clientX, event.clientY));
    setStatus('');
    setHasError(false);
  }

  function handlePointerUp(event) {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDrag(null);
    setHoverTarget('');

    // If item was tapped/clicked without moving:
    if (!state.moved) {
      if (state.inCategory) {
        // Clicking an item in a category removes it back to the pool
        setAssignments((current) => {
          const next = {};
          Object.entries(current).forEach(([catId, ids]) => {
            next[catId] = (ids || []).filter((id) => id !== state.id);
          });
          return next;
        });
        setStatus('');
        setHasError(false);
      }
      return;
    }

    const target = targetAt(event.clientX, event.clientY);
    if (!target) return; // dropped on nothing: stays where it was

    setAssignments((current) => {
      const next = {};
      Object.entries(current).forEach(([catId, ids]) => {
        next[catId] = (ids || []).filter((id) => id !== state.id);
      });

      if (target !== 'pool') {
        const category = categories.find((cat) => cat.id === target);
        if (!category) return current;
        const capacity = Number(category.capacity) || Infinity;
        if (capacity === 1) {
          // Replace single item slot
          next[target] = [state.id];
        } else if ((next[target] || []).length < capacity) {
          next[target] = [...(next[target] || []), state.id];
        } else {
          return current;
        }
      }
      return next;
    });
  }

  function resetTask() {
    if (checking || isSolved) return;
    setAssignments(sanitizeAssignments({}, categories, items));
    setStatus('');
    setHasError(false);
  }

  async function checkTask() {
    if (checking || isSolved || !hasData) return;

    if (poolItems.length > 0) {
      setStatus(`Please place all the pictures first (${items.length - poolItems.length}/${items.length})`);
      setHasError(true);
      return;
    }

    const allRight = categories.every((cat) => sameSet(assignments[cat.id] || [], cat.answer));
    if (!allRight) {
      setStatus('Almost there! Try again.');
      setHasError(true);
      return;
    }

    setChecking(true);
    setStatus('Checking...');
    setHasError(false);

    const answer = { assignments: Object.fromEntries(categories.map((cat) => [cat.id, [...(assignments[cat.id] || [])]])) };

    try {
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
      console.warn('[CategoryDragTask] Could not save CK2 answer:', error);
      setStatus('Could not save or verify your answer. Please try again.');
      setHasError(true);
    } finally {
      setChecking(false);
    }
  }

  function renderItem(item, { inCategory = false, isPlaced = false } = {}) {
    const isDragging = drag?.id === item.id;
    return (
      <div
        key={`${item.id}-${inCategory ? 'cat' : 'pool'}`}
        className={[
          'category-drag-item',
          item.text ? 'is-text' : '',
          isDragging ? 'is-source' : '',
          isPlaced ? 'is-placed' : '',
          isSolved ? 'is-locked' : '',
          inCategory ? 'in-category' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={!item.text && item.w ? { maxWidth: inCategory ? '100%' : item.w } : undefined}
        onPointerDown={(event) => {
          if (isPlaced) return;
          handlePointerDown(event, item, inCategory);
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        role="button"
        tabIndex={isSolved || isPlaced ? -1 : 0}
        aria-label={item.alt || item.text || `Item ${item.id}`}
      >
        {item.text ? <span>{item.text}</span> : <img src={item.src} alt={item.alt || ''} draggable={false} />}
      </div>
    );
  }

  const draggedItem = drag ? itemById.get(drag.id) : null;

  return (
    <LmsActivityFrame
      title={task?.title || data.title}
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
      <article className="category-drag-task">
        <header className="category-drag-header">
          <div className="category-drag-top-meta">
            <span className={`category-drag-task-title ${isSolved ? 'is-solved' : ''}`}>
              {isSolved && <span className="category-drag-check">✓ </span>}
              {task?.title || 'Part 1. My correct solution'}
            </span>
            <span className="category-drag-attempt">{data.attempt || 'Attempt: 1/2'}</span>
          </div>
          {data.title && (
            <h1 className="category-drag-instruction">{data.title}</h1>
          )}
        </header>

        {data.referenceImage && (
          <div className="category-drag-reference">
            <img src={data.referenceImage} alt="Reference" draggable={false} />
          </div>
        )}

        {!hasData ? (
          <div className="category-drag-empty">This activity is not set up yet.</div>
        ) : (
          <div className={`category-drag-board ${data.layout === 'side' ? 'is-side' : 'is-top'}`}>
            <div
              className={`category-drag-pool ${hoverTarget === 'pool' ? 'is-hover' : ''}`}
              data-drop-target="pool"
              aria-label="Item pool"
            >
              {(data.layout === 'side' ? items.filter((item) => !placedIds.has(item.id)) : items).map((item) => {
                const isPlaced = data.layout !== 'side' && placedIds.has(item.id);
                return renderItem(item, { isPlaced, inCategory: false });
              })}
            </div>

            {data.layout !== 'side' && <div className="category-drag-divider" />}

            <div className="category-drag-categories" style={{ '--cat-count': categories.length }}>
              {categories.map((cat) => {
                const ids = assignments[cat.id] || [];
                const ok = isSolved || (hasError && ids.length > 0 && sameSet(ids, cat.answer));
                const bad = hasError && ids.length > 0 && !sameSet(ids, cat.answer);
                return (
                  <section key={cat.id} className="category-drag-column">
                    <header className="category-drag-column-head">
                      {cat.imageSrc ? (
                        <img src={cat.imageSrc} alt={cat.title || ''} draggable={false} />
                      ) : (
                        <span>{cat.title}</span>
                      )}
                    </header>
                    <div
                      className={[
                        'category-drag-drop',
                        ids.length > 0 ? 'has-item' : '',
                        hoverTarget === cat.id ? 'is-hover' : '',
                        ok ? 'is-right' : '',
                        bad ? 'is-wrong' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      data-drop-target={cat.id}
                    >
                      {ids
                        .map((id) => itemById.get(id))
                        .filter(Boolean)
                        .map((item) => renderItem(item, { inCategory: true, isPlaced: false }))}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        )}

        {drag && draggedItem && (
          <div
            className={`category-drag-ghost ${draggedItem.text ? 'is-text' : ''}`}
            style={{ left: drag.x, top: drag.y, width: drag.w, height: drag.h }}
          >
            {draggedItem.text ? <span>{draggedItem.text}</span> : <img src={draggedItem.src} alt="" draggable={false} />}
          </div>
        )}
      </article>
    </LmsActivityFrame>
  );
}
