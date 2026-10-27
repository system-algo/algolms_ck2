import { useEffect, useMemo, useState } from 'react';
import './SequenceOrderTask.css';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import {
  getUniqueImages,
  loadLocalTaskState,
  saveLocalTaskState,
  resolveActivityMapUrl,
} from '../lib/taskExtractors.js';

const API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  localStorage.getItem('lms_backend_url') ||
  sessionStorage.getItem('lms_backend_url') ||
  ''
).replace(/\/+$/, '');

const SESSION_STORAGE_KEY = 'algolms_session_id';

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTaskId(task) {
  return String(task?.id || task?.taskId || '').trim();
}

function getManualMapUrl(pageInstance) {
  return resolveActivityMapUrl(pageInstance?.manualActivityMap);
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
  } catch {}

  return {
    courseId: courseId || pageInstance?.courseId || pageInstance?.course?.id || pageInstance?.course || '',
    lessonId: lessonId || pageInstance?.lessonId || pageInstance?.lesson?.id || pageInstance?.lesson || '',
    pageId: pageId || pageInstance?.pageId || pageInstance?.page?.id || pageInstance?.id || '',
  };
}

function getSessionId() {
  try {
    const params = new URLSearchParams(window.location.search);
    const qSession = params.get('sessionId') || params.get('session');
    if (qSession) return qSession;

    const existing = localStorage.getItem(SESSION_STORAGE_KEY) || localStorage.getItem('lms-session-id');
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

function getUserId() {
  try {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get('userId') ||
      params.get('studentEmail') ||
      params.get('email') ||
      localStorage.getItem('lms_student_email') ||
      sessionStorage.getItem('lms_student_email') ||
      'student@algo.edu.vn'
    );
  } catch {
    return 'student@algo.edu.vn';
  }
}

function collectTextLines(value, output = [], depth = 0) {
  if (depth > 12 || value == null) return output;

  if (typeof value === 'string') {
    String(value)
      .replace(/\r/g, '\n')
      .split('\n')
      .map(normalizeText)
      .filter(Boolean)
      .forEach((line) => output.push(line));

    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectTextLines(item, output, depth + 1));
    return output;
  }

  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectTextLines(item, output, depth + 1));
  }

  return output;
}

function uniqueLines(lines) {
  const seen = new Set();
  return lines.filter((line) => {
    const key = normalizeText(line).toLowerCase();
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isNoiseLine(line) {
  const text = normalizeText(line);
  const lower = text.toLowerCase();

  if (!lower) return true;
  if (lower === 'answer') return true;
  if (lower === 'reset') return true;
  if (lower === 'check') return true;
  if (lower === 'next') return true;
  if (lower === 'show raw capture') return true;
  if (lower === 'static content rendered from capture data.') return true;

  if (/^attempt\s*:?\s*\d+\/\d+$/i.test(text)) return true;
  if (/^task-\w+/i.test(text)) return true;
  if (/^after-\d+/i.test(text)) return true;
  if (/^https?:\/\//i.test(text)) return true;
  if (/^\d{4}-\d{2}-\d{2}t/i.test(text)) return true;

  if (lower.includes('generic_captured_task')) return true;
  if (lower.includes('generic-captured-task')) return true;
  if (lower.includes('mcq_checkbox_task')) return true;
  if (lower.includes('matching_dragdrop_task')) return true;
  if (lower.includes('screenshots/')) return true;
  if (lower.includes('lms-template-capture/')) return true;
  if (lower.includes('toolbar')) return true;
  if (lower.includes('icon-control')) return true;
  if (lower.includes('rgba(')) return true;
  if (lower.includes('<div')) return true;
  if (lower.includes('<svg')) return true;
  if (lower.includes('data-qa')) return true;
  if (lower.includes('stroke-width')) return true;

  return false;
}

function toItem(rawItem, index) {
  if (typeof rawItem === 'string') {
    const text = normalizeText(rawItem);
    return {
      id: `item-${index + 1}`,
      text,
      image: '',
      alt: text,
    };
  }

  return {
    id: String(rawItem?.id || rawItem?.itemId || `item-${index + 1}`),
    text: normalizeText(rawItem?.text || rawItem?.title || rawItem?.label || ''),
    image: rawItem?.image || rawItem?.imageUrl || rawItem?.src || rawItem?.url || '',
    alt: normalizeText(rawItem?.alt || rawItem?.title || rawItem?.text || `Item ${index + 1}`),
  };
}

function getFallbackConfig(task) {
  const lines = uniqueLines(collectTextLines(task)).filter((line) => !isNoiseLine(line));
  const title = task?.title || lines[0] || 'Arrange in order';
  const titleLower = title.toLowerCase();

  const items = lines
    .filter((line) => line.toLowerCase() !== titleLower)
    .filter((line) => line.length > 4)
    .slice(0, 8);

  return {
    title,
    instruction: title,
    items,
    correctOrder: items,
    attemptsAllowed: 2,
  };
}

function getConfigFromTask(task, pageInstance) {
  const taskId = getTaskId(task);
  return (
    task?.sequenceOrder ||
    task?.sequence ||
    task?.orderTask ||
    (taskId ? pageInstance?.taskRenderers?.[taskId]?.sequenceOrder : null) ||
    null
  );
}

function moveItem(items, fromIndex, toIndex) {
  if (fromIndex === toIndex) return items;
  if (fromIndex < 0 || toIndex < 0) return items;
  if (fromIndex >= items.length || toIndex >= items.length) return items;

  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);

  return next;
}

function getConfiguredOrder(config, initialItems) {
  const rawOrder =
    Array.isArray(config.answerOrder)
      ? config.answerOrder
      : Array.isArray(config.answerKey)
        ? config.answerKey
        : Array.isArray(config.correctOrder)
          ? config.correctOrder
          : [];

  if (!rawOrder.length) return initialItems.map((item) => item.id);

  const itemIds = new Set(initialItems.map((item) => item.id));
  const textToId = new Map(
    initialItems.map((item) => [normalizeText(item.text).toLowerCase(), item.id]),
  );

  return rawOrder
    .map((item) => {
      if (typeof item === 'string') {
        const clean = normalizeText(item);
        if (itemIds.has(clean)) return clean;
        return textToId.get(clean.toLowerCase()) || clean;
      }

      const id = String(item?.id || item?.itemId || '').trim();
      if (id) return id;

      const text = normalizeText(item?.text || item?.title || item?.label || '');
      return textToId.get(text.toLowerCase()) || text;
    })
    .filter(Boolean)
    .filter((item) => !isNoiseLine(item));
}

function sameOrderById(items, correctOrderIds) {
  if (!items.length || !correctOrderIds.length) return false;
  if (items.length !== correctOrderIds.length) return false;
  return items.every((item, index) => item.id === correctOrderIds[index]);
}

export default function SequenceOrderTask({
  task,
  pageInstance,
  onPrevTask,
  onNextTask,
  onTaskCompleted,
  onTaskComplete,
  isTaskDone = false,
}) {
  const taskId = getTaskId(task);
  const storageKey = `seq-order-${task.id || taskId}`;

  const fallbackConfig = useMemo(() => getFallbackConfig(task), [task]);
  const [manualConfig, setManualConfig] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setManualConfig(null);

    const url = getManualMapUrl(pageInstance);
    if (!url || !taskId) return undefined;

    fetch(url)
      .then((response) => (response.ok ? response.json() : null))
      .then((manualMap) => {
        if (cancelled || !manualMap) return;
        const manualTask = manualMap?.tasks?.[taskId] || null;
        const nextConfig =
          manualTask?.sequenceOrder ||
          manualTask?.sequence ||
          manualTask?.orderTask ||
          null;
        setManualConfig(nextConfig);
      })
      .catch(() => {
        if (!cancelled) setManualConfig(null);
      });

    return () => {
      cancelled = true;
    };
  }, [pageInstance, taskId]);

  const directConfig = getConfigFromTask(task, pageInstance);
  const config = manualConfig || directConfig || fallbackConfig;

  const initialItems = useMemo(() => {
    const rawItems = Array.isArray(config.items) ? config.items : [];
    return rawItems
      .map(toItem)
      .filter((item) => item.text || item.image)
      .filter((item) => !item.text || !isNoiseLine(item.text));
  }, [config]);

  const isImageSequence = useMemo(() => {
    if (config?.layout === 'image-sequence') return true;
    return initialItems.length > 0 && initialItems.some((item) => Boolean(item.image));
  }, [config, initialItems]);

  const correctOrderIds = useMemo(
    () => getConfiguredOrder(config, initialItems),
    [config, initialItems],
  );

  // Initial source items in order
  const sourceItems = useMemo(() => {
    if (Array.isArray(config?.initialOrder) && config.initialOrder.length) {
      const orderMap = new Map(config.initialOrder.map((id, idx) => [id, idx]));
      return [...initialItems].sort((a, b) => {
        const orderA = orderMap.has(a.id) ? orderMap.get(a.id) : 999;
        const orderB = orderMap.has(b.id) ? orderMap.get(b.id) : 999;
        return orderA - orderB;
      });
    }
    return initialItems;
  }, [config, initialItems]);

  // Image sequence slots state
  const [imageSlots, setImageSlots] = useState(() => {
    if (isTaskDone) {
      return correctOrderIds.map((id) => initialItems.find((it) => it.id === id) || null);
    }
    const saved = loadLocalTaskState(storageKey, null);
    if (Array.isArray(saved?.imageSlotIds) && saved.imageSlotIds.length === initialItems.length) {
      return saved.imageSlotIds.map((id) => (id ? initialItems.find((it) => it.id === id) || null : null));
    }
    return Array(initialItems.length).fill(null);
  });

  // Text items state (legacy vertical mode)
  const [textItems, setTextItems] = useState([]);
  const [draggedId, setDraggedId] = useState('');
  const [dragData, setDragData] = useState(null);
  const [hoveredSlotIndex, setHoveredSlotIndex] = useState(null);
  const [status, setStatus] = useState('');
  const [results, setResults] = useState({});
  const [checking, setChecking] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!initialItems.length) return;
    if (isTaskDone) {
      setImageSlots(correctOrderIds.map((id) => initialItems.find((it) => it.id === id) || null));
      return;
    }
    const saved = loadLocalTaskState(storageKey, null);
    if (Array.isArray(saved?.imageSlotIds) && saved.imageSlotIds.length === initialItems.length) {
      setImageSlots(saved.imageSlotIds.map((id) => (id ? initialItems.find((it) => it.id === id) || null : null)));
      setStatus(saved?.status || '');
    } else {
      setImageSlots((prev) => (prev.length === initialItems.length ? prev : Array(initialItems.length).fill(null)));
    }
  }, [isTaskDone, storageKey, initialItems, correctOrderIds]);

  useEffect(() => {
    if (isImageSequence && imageSlots.length > 0) {
      saveLocalTaskState(storageKey, {
        imageSlotIds: imageSlots.map((s) => s?.id || null),
        status,
      });
    }
  }, [isImageSequence, storageKey, imageSlots, status]);

  // Legacy text items sync
  useEffect(() => {
    if (!isImageSequence) {
      const saved = loadLocalTaskState(storageKey, null);
      if (Array.isArray(saved?.items) && saved.items.length) {
        setTextItems(saved.items);
      } else {
        setTextItems(initialItems);
      }
    }
  }, [isImageSequence, storageKey, initialItems]);

  const images = useMemo(() => getUniqueImages(task), [task]);
  const image = images[0] || null;

  function triggerSuccess(submittedOrder) {
    const effectiveTaskId = String(task?.id || task?.taskId || taskId || 'task-2').trim();
    window.dispatchEvent(
      new CustomEvent('LMS_TASK_COMPLETED', {
        detail: { taskId: effectiveTaskId },
      })
    );

    import('../utils/lmsSounds.js')
      .then(({ playLmsSound, LMS_SOUND_TYPES }) => {
        playLmsSound(LMS_SOUND_TYPES.COMPLETE_ACTIVITY);
      })
      .catch(() => {});

    const completionPayload = {
      taskId: effectiveTaskId,
      activityType: 'sequence-order-task',
      completionType: 'correct',
      isCorrect: true,
      score: 1,
      maxScore: 1,
      feedback: 'Correct!',
      metadata: { order: submittedOrder },
    };

    if (typeof onTaskCompleted === 'function') {
      onTaskCompleted(completionPayload);
    } else if (typeof onTaskComplete === 'function') {
      onTaskComplete(completionPayload);
    }

    if (onNextTask) {
      setTimeout(onNextTask, 1200);
    }
  }

  async function submitAttemptToBackend(submittedOrder) {
    if (!API_BASE_URL) return null;

    const { courseId, lessonId, pageId } = getRuntimeIds(pageInstance);
    const effectiveCourseId = courseId || 'CK';
    const effectiveTaskId = String(task?.id || task?.taskId || taskId || '').trim();

    try {
      const response = await fetch(`${API_BASE_URL}/api/activity-attempts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: getSessionId(),
          userId: getUserId(),
          courseId: effectiveCourseId,
          lessonId: lessonId || '',
          pageId: pageId || '',
          taskId: effectiveTaskId,
          activityType: 'sequence-order-task',
          answer: {
            itemOrder: submittedOrder,
            order: submittedOrder,
          },
          isCorrect: true,
          score: 1,
          maxScore: 1,
        }),
      });

      return response.ok ? await response.json().catch(() => null) : null;
    } catch {
      return null;
    }
  }

  // --- Image Sequence Handlers ---
  function handlePlaceFromPool(item) {
    if (isTaskDone) return;
    setStatus('');
    setHasError(false);

    setImageSlots((current) => {
      const nextEmptyIndex = current.findIndex((slot) => slot === null);
      if (nextEmptyIndex === -1) return current;
      const next = [...current];
      next[nextEmptyIndex] = item;
      return next;
    });
  }

  function handleRemoveFromSlot(index) {
    if (isTaskDone) return;
    setStatus('');
    setHasError(false);

    setImageSlots((current) => {
      const next = [...current];
      next[index] = null;
      return next;
    });
  }

  function handleImageDragStart(event, item, source, fromIndex = null) {
    if (isTaskDone) return;
    const payload = { item, source, fromIndex };
    setDragData(payload);
    event.dataTransfer.setData('text/plain', JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleImageDropOnSlot(event, targetIndex) {
    event.preventDefault();
    setHoveredSlotIndex(null);
    if (isTaskDone) return;

    let payload = dragData;
    if (!payload) {
      try {
        payload = JSON.parse(event.dataTransfer.getData('text/plain'));
      } catch {
        return;
      }
    }

    if (!payload?.item) return;

    setStatus('');
    setHasError(false);

    setImageSlots((current) => {
      const next = [...current];
      const { item, source, fromIndex } = payload;

      if (source === 'pool') {
        const existingAtTarget = next[targetIndex];
        // If item was already placed elsewhere, clear that old slot
        const oldPlacedIndex = next.findIndex((s) => s?.id === item.id);
        if (oldPlacedIndex !== -1 && oldPlacedIndex !== targetIndex) {
          next[oldPlacedIndex] = existingAtTarget;
        }
        next[targetIndex] = item;
      } else if (source === 'slot' && fromIndex !== null) {
        if (fromIndex === targetIndex) return current;
        // Swap slots
        const temp = next[targetIndex];
        next[targetIndex] = next[fromIndex];
        next[fromIndex] = temp;
      }

      return next;
    });

    setDragData(null);
  }

  function checkImageSequence() {
    const filledCount = imageSlots.filter(Boolean).length;
    if (filledCount < initialItems.length) {
      setStatus(`Please place all pictures in order before checking. (${filledCount}/${initialItems.length})`);
      setHasError(true);
      return;
    }

    const currentOrderIds = imageSlots.map((it) => it?.id || '');
    const isCorrect = currentOrderIds.every((id, idx) => id === correctOrderIds[idx]);

    if (isCorrect) {
      setStatus('Correct!');
      setHasError(false);
      triggerSuccess(currentOrderIds);
      submitAttemptToBackend(currentOrderIds);
    } else {
      setStatus('A mistake has been made! Try again.');
      setHasError(true);
    }
  }

  function resetImageSequence() {
    setImageSlots(Array(initialItems.length).fill(null));
    setStatus('');
    setHasError(false);
    localStorage.removeItem(storageKey);
  }

  // --- Text Sequence Handlers (Fallback/Legacy) ---
  function handleTextDragStart(event, itemId) {
    setDraggedId(itemId);
    event.dataTransfer.setData('text/plain', itemId);
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleTextDrop(event, targetId) {
    event.preventDefault();
    if (checking) return;
    const sourceId = event.dataTransfer.getData('text/plain') || draggedId;
    if (!sourceId || !targetId || sourceId === targetId) return;

    setTextItems((current) => {
      const fromIndex = current.findIndex((item) => item.id === sourceId);
      const toIndex = current.findIndex((item) => item.id === targetId);
      return moveItem(current, fromIndex, toIndex);
    });

    setDraggedId('');
    setResults({});
    setStatus('');
  }

  function checkTextSequence() {
    if (!textItems.length) return;
    setChecking(true);
    const isCorrect = sameOrderById(textItems, correctOrderIds);
    setStatus(isCorrect ? 'Correct!' : 'A mistake has been made! Try again.');
    if (isCorrect) {
      triggerSuccess(textItems.map((it) => it.id));
      submitAttemptToBackend(textItems.map((it) => it.id));
    }
    setChecking(false);
  }

  function resetTextSequence() {
    setTextItems(initialItems);
    setStatus('');
    setResults({});
  }

  const isSolved = Boolean(
    isTaskDone ||
    (isImageSequence &&
      imageSlots.filter(Boolean).length === initialItems.length &&
      imageSlots.every((s, i) => s?.id === correctOrderIds[i]))
  );

  return (
    <LmsActivityFrame
      title={config.title || fallbackConfig.title}
      status={status}
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
      onCheck={isImageSequence ? checkImageSequence : checkTextSequence}
      onReset={isImageSequence ? resetImageSequence : resetTextSequence}
      isCheckDisabled={checking}
      isResetDisabled={checking}
      isCheckLoading={checking}
      isTaskDone={isSolved}
    >
      {isImageSequence ? (
        <article className="sequence-image-task">
          <header className="sequence-image-header">
            <h1 className={`sequence-image-title ${isSolved ? 'is-solved' : ''}`}>
              {isSolved && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    backgroundColor: '#22c55e',
                    color: '#ffffff',
                    fontSize: 13,
                    fontWeight: 900,
                  }}
                >
                  ✓
                </span>
              )}
              {config.title || 'Part 1. My correct solution'}
            </h1>
            <p className="sequence-image-instruction">
              {config.instruction || 'Put it in order'}
            </p>
          </header>

          {/* Top Pool: Initial Cards */}
          <div className="sequence-image-pool" aria-label="Available picture cards">
            {sourceItems.map((item) => {
              const isPlaced = imageSlots.some((slot) => slot?.id === item.id);
              return (
                <div
                  key={`pool-${item.id}`}
                  className={`sequence-image-card ${isPlaced ? 'is-placed' : 'is-available'}`}
                  draggable={!isPlaced && !isTaskDone}
                  onDragStart={(e) => handleImageDragStart(e, item, 'pool')}
                  onClick={() => !isPlaced && !isTaskDone && handlePlaceFromPool(item)}
                  title={isPlaced ? 'Already placed in sequence' : 'Click or drag to place'}
                >
                  <img src={item.image} alt={item.alt || ''} draggable={false} />
                </div>
              );
            })}
          </div>

          {/* Bottom Targets: 4 Ordered Slots */}
          <div
            className={`sequence-image-targets-wrapper ${isSolved ? 'is-solved' : ''} ${hasError ? 'is-error' : ''}`}
          >
            <div className="sequence-image-targets" aria-label="Ordered sequence slots">
              {imageSlots.map((slotItem, index) => {
                const isHovered = hoveredSlotIndex === index;
                return (
                  <div
                    key={`slot-${index}`}
                    className={`sequence-image-slot ${slotItem ? 'has-item' : 'is-empty'} ${isHovered ? 'is-hovered' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setHoveredSlotIndex(index);
                    }}
                    onDragLeave={() => setHoveredSlotIndex(null)}
                    onDrop={(e) => handleImageDropOnSlot(e, index)}
                    onClick={() => slotItem && handleRemoveFromSlot(index)}
                    title={slotItem ? 'Click to remove back to top' : `Slot ${index + 1}`}
                  >
                    {slotItem ? (
                      <div
                        className="sequence-image-slot-item"
                        draggable={!isTaskDone}
                        onDragStart={(e) => handleImageDragStart(e, slotItem, 'slot', index)}
                      >
                        <img src={slotItem.image} alt={slotItem.alt || ''} draggable={false} />
                      </div>
                    ) : (
                      <span className="sequence-image-slot-empty-num">{index + 1}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </article>
      ) : (
        /* Legacy Text List Sequence */
        <article className="sequence-order-task">
          <aside className="sequence-order-side-card">
            {image ? (
              <img
                className="sequence-order-image"
                src={image.src}
                alt={image.alt || ''}
                draggable={false}
              />
            ) : null}

            <div className="sequence-order-side-content">
              <h1>{config.instruction || config.title}</h1>
              {config.helperText ? <p>{config.helperText}</p> : null}
            </div>
          </aside>

          <section className="sequence-order-list" aria-label="Sortable steps">
            {textItems.map((item, index) => (
              <div
                key={item.id}
                className="sequence-order-row"
                draggable={!checking}
                onDragStart={(event) => handleTextDragStart(event, item.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleTextDrop(event, item.id)}
              >
                <div className="sequence-order-number">{index + 1}</div>
                <div className="sequence-order-block">{item.text}</div>
              </div>
            ))}
          </section>
        </article>
      )}
    </LmsActivityFrame>
  );
}
