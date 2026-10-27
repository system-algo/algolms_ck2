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
 * Every picture/word is unique: dragging it into a category removes it from the pool.
 *
 * Map config (tasks[taskId].categoryDrag):
 * {
 *   title, layout: 'top' | 'side' (pool above, or pool in a left column),
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
  return {
    title: String(config.title || '').trim(),
    layout: config.layout === 'side' ? 'side' : 'top',
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
  const [drag, setDrag] = useState(null); // { id, x, y }
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

  function handlePointerDown(event, item) {
    if (isSolved || checking) return;
    if (event.button !== undefined && event.button !== 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      id: item.id,
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
    if (!state.moved) return;

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
        if ((next[target] || []).length >= capacity) return current;
        next[target] = [...(next[target] || []), state.id];
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

  function renderItem(item, { inCategory = false } = {}) {
    const isDragging = drag?.id === item.id;
    return (
      <div
        key={item.id}
        className={['category-drag-item', item.text ? 'is-text' : '', isDragging ? 'is-source' : '', isSolved ? 'is-locked' : '']
          .filter(Boolean)
          .join(' ')}
        style={!item.text && item.w ? { maxWidth: inCategory ? '100%' : item.w } : undefined}
        onPointerDown={(event) => handlePointerDown(event, item)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        role="button"
        tabIndex={isSolved ? -1 : 0}
        aria-label={item.alt || item.text || `Item ${item.id}`}
      >
        {item.text ? <span>{item.text}</span> : <img src={item.src} alt={item.alt || ''} draggable={false} />}
      </div>
    );
  }

  const draggedItem = drag ? itemById.get(drag.id) : null;

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
      <article className="category-drag-task">
        <h1 className={`category-drag-title ${isSolved ? 'is-solved' : ''}`}>
          {isSolved && <span className="category-drag-badge">✓</span>}
          {data.title}
        </h1>

        {!hasData ? (
          <div className="category-drag-empty">This activity is not set up yet.</div>
        ) : (
          <div className={`category-drag-board ${data.layout === 'side' ? 'is-side' : ''}`}>
            <div
              className={`category-drag-pool ${hoverTarget === 'pool' ? 'is-hover' : ''}`}
              data-drop-target="pool"
            >
              {poolItems.map((item) => renderItem(item))}
            </div>

            <div className="category-drag-categories" style={{ '--cat-count': categories.length }}>
              {categories.map((cat) => {
                const ids = assignments[cat.id] || [];
                const ok = isSolved || (hasError && ids.length > 0 && sameSet(ids, cat.answer));
                const bad = hasError && ids.length > 0 && !sameSet(ids, cat.answer);
                return (
                  <section key={cat.id} className="category-drag-column">
                    <header className="category-drag-column-head">
                      {cat.imageSrc ? <img src={cat.imageSrc} alt={cat.title || ''} draggable={false} /> : <span>{cat.title}</span>}
                    </header>
                    <div
                      className={[
                        'category-drag-drop',
                        hoverTarget === cat.id ? 'is-hover' : '',
                        ok ? 'is-right' : '',
                        bad ? 'is-wrong' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      data-drop-target={cat.id}
                    >
                      {ids.map((id) => itemById.get(id)).filter(Boolean).map((item) => renderItem(item, { inCategory: true }))}
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
