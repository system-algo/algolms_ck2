import { useEffect, useMemo, useState } from 'react';
import './SequenceOrderTask.css';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import {
  getUniqueImages,
  loadLocalTaskState,
  saveLocalTaskState,
  resolveActivityMapUrl,
} from '../lib/taskExtractors.js';

const API_BASE_URL = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
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
    };
  }

  return {
    id: String(rawItem?.id || rawItem?.itemId || `item-${index + 1}`),
    text: normalizeText(rawItem?.text || rawItem?.title || rawItem?.label || ''),
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

function getConfigFromTask(task) {
  return task?.sequenceOrder || task?.sequence || task?.orderTask || null;
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

  if (!rawOrder.length) return [];

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

function getConfiguredTextOrder(config, initialItems) {
  const expectedIds = getConfiguredOrder(config, initialItems);

  if (expectedIds.length) {
    return expectedIds.map((idOrText) => {
      const matchedItem = initialItems.find((item) => item.id === idOrText);

      return matchedItem?.text || idOrText;
    });
  }

  return [];
}

function sameOrderById(items, correctOrderIds) {
  if (!items.length || !correctOrderIds.length) return false;
  if (items.length !== correctOrderIds.length) return false;

  return items.every((item, index) => item.id === correctOrderIds[index]);
}

function sameOrderByText(items, correctTextOrder) {
  if (!items.length || !correctTextOrder.length) return false;
  if (items.length !== correctTextOrder.length) return false;

  return items.every((item, index) => normalizeText(item.text) === normalizeText(correctTextOrder[index]));
}

function getResultMapById(items, correctOrderIds) {
  const result = {};

  items.forEach((item, index) => {
    result[item.id] = item.id === correctOrderIds[index];
  });

  return result;
}

function getResultMapByText(items, correctTextOrder) {
  const result = {};

  items.forEach((item, index) => {
    result[item.id] = normalizeText(item.text) === normalizeText(correctTextOrder[index]);
  });

  return result;
}

function getItemSetSignature(value = []) {
  return value
    .map((item) => normalizeText(item?.text || item))
    .filter(Boolean)
    .sort()
    .join('|');
}

export default function SequenceOrderTask({
  task,
  pageInstance,
  onPrevTask,
  onNextTask,
  isTaskDone,
}) {
  const taskId = getTaskId(task);
  const storageKey = task.id || taskId;

  const fallbackConfig = useMemo(() => getFallbackConfig(task), [task]);
  const [manualConfig, setManualConfig] = useState(null);

  useEffect(() => {
    let cancelled = false;

    setManualConfig(null);

    const url = getManualMapUrl(pageInstance);

    if (!url || !taskId) return undefined;

    fetch(url)
      .then((response) => {
        if (!response.ok) return null;
        return response.json();
      })
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
        if (!cancelled) {
          setManualConfig(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pageInstance, taskId]);

  const directConfig = getConfigFromTask(task);
  const config = manualConfig || directConfig || fallbackConfig;

  const initialItems = useMemo(() => {
    const rawItems = Array.isArray(config.items) ? config.items : [];

    return rawItems
      .map(toItem)
      .filter((item) => item.text)
      .filter((item) => !isNoiseLine(item.text));
  }, [config]);

  const correctOrderIds = useMemo(
    () => getConfiguredOrder(config, initialItems),
    [config, initialItems],
  );

  const correctTextOrder = useMemo(
    () => getConfiguredTextOrder(config, initialItems),
    [config, initialItems],
  );

  const [items, setItems] = useState([]);
  const [draggedId, setDraggedId] = useState('');
  const [status, setStatus] = useState('');
  const [results, setResults] = useState({});
  const [checking, setChecking] = useState(false);

  const images = useMemo(() => getUniqueImages(task), [task]);
  const image = images[0] || null;

  useEffect(() => {
    const saved = loadLocalTaskState(storageKey, null);
    const savedItems = Array.isArray(saved?.items) ? saved.items : [];

    const savedSignature = getItemSetSignature(savedItems);
    const currentSignature = getItemSetSignature(initialItems);

    if (savedItems.length && savedSignature === currentSignature) {
      setItems(savedItems);
      setStatus(saved?.status || '');
      setResults(saved?.results || {});
      setChecking(false);
      return;
    }

    setItems(initialItems);
    setStatus('');
    setResults({});
    setChecking(false);
  }, [storageKey, initialItems]);

  useEffect(() => {
    if (!items.length) return;

    saveLocalTaskState(storageKey, {
      items,
      status,
      results,
    });
  }, [storageKey, items, status, results]);

  function handleDragStart(event, itemId) {
    setDraggedId(itemId);
    event.dataTransfer.setData('application/x-sequence-item', itemId);
    event.dataTransfer.setData('text/plain', itemId);
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleDrop(event, targetId) {
    event.preventDefault();

    if (checking) return;

    const sourceId =
      event.dataTransfer.getData('application/x-sequence-item') ||
      event.dataTransfer.getData('text/plain') ||
      draggedId;

    if (!sourceId || !targetId || sourceId === targetId) return;

    setItems((current) => {
      const fromIndex = current.findIndex((item) => item.id === sourceId);
      const toIndex = current.findIndex((item) => item.id === targetId);

      return moveItem(current, fromIndex, toIndex);
    });

    setDraggedId('');
    setResults({});
    setStatus('');
  }

  function moveUp(itemId) {
    if (checking) return;

    setItems((current) => {
      const index = current.findIndex((item) => item.id === itemId);
      return moveItem(current, index, index - 1);
    });

    setResults({});
    setStatus('');
  }

  function moveDown(itemId) {
    if (checking) return;

    setItems((current) => {
      const index = current.findIndex((item) => item.id === itemId);
      return moveItem(current, index, index + 1);
    });

    setResults({});
    setStatus('');
  }

  function resetAnswer() {
    if (checking) return;

    setItems(initialItems);
    setDraggedId('');
    setStatus('');
    setResults({});
  }

  function triggerSuccess() {
    window.dispatchEvent(
      new CustomEvent('LMS_TASK_COMPLETED', {
        detail: { taskId: task?.id || taskId },
      })
    );

    if (onNextTask) {
      setTimeout(onNextTask, 1000);
    }
  }

  function runLocalCheck() {
    if (correctOrderIds.length) {
      const nextResults = getResultMapById(items, correctOrderIds);
      const isCorrect = sameOrderById(items, correctOrderIds);

      setResults(nextResults);
      setStatus(isCorrect ? 'Correct!' : 'A mistake has been made! Try again.');
      if (isCorrect) triggerSuccess();
      return;
    }

    if (correctTextOrder.length) {
      const nextResults = getResultMapByText(items, correctTextOrder);
      const isCorrect = sameOrderByText(items, correctTextOrder);

      setResults(nextResults);
      setStatus(isCorrect ? 'Correct!' : 'A mistake has been made! Try again.');
      if (isCorrect) triggerSuccess();
      return;
    }

    const nextResults = {};
    items.forEach((item) => {
      nextResults[item.id] = true;
    });
    setResults(nextResults);
    setStatus('Correct!');
    triggerSuccess();
  }

  function getAnswerPayload() {
    return {
      itemOrder: items.map((item) => item.id),
      itemTextOrder: items.map((item) => item.text),
    };
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
        activityType: 'sequence-order-task',
        answer: getAnswerPayload(),
      }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error?.message || 'Could not submit answer.');
    }

    return payload;
  }

  function applyBackendResult(payload) {
    const result = payload?.result || payload?.attempt?.result || {};
    const details = result.details || {};

    if (details.itemResults && typeof details.itemResults === 'object') {
      setResults(details.itemResults);
    }

    if (result.isCorrect === true || payload?.attempt?.isCorrect === true) {
      setStatus('Correct!');
      triggerSuccess();
      return;
    }

    if (result.status === 'missing_answer_key') {
      setStatus('Answer saved. No backend answer key found.');
      return;
    }

    if (result.status === 'incomplete') {
      setStatus(result.feedback || 'Please arrange all items first.');
      return;
    }

    if (result.feedback || payload?.attempt?.feedback) {
      setStatus(result.feedback || payload.attempt.feedback);
      return;
    }

    setStatus('A mistake has been made! Try again.');
  }

  async function checkAnswer() {
    if (!items.length) {
      setStatus('No sequence items configured for this task.');
      setResults({});
      return;
    }

    setChecking(true);
    setStatus('Checking...');

    try {
      const payload = await submitAttemptToBackend();

      if (!payload) {
        runLocalCheck();
        return;
      }

      applyBackendResult(payload);
    } catch (error) {
      console.error('[SEQUENCE_ORDER_SUBMIT_ERROR]', error);
      runLocalCheck();
    } finally {
      setChecking(false);
    }
  }

  return (
    <LmsActivityFrame
      title={config.title || fallbackConfig.title}
      status={status}
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
      onCheck={checkAnswer}
      onReset={resetAnswer}
      isCheckDisabled={checking}
      isResetDisabled={checking}
      isCheckLoading={checking}
      isTaskDone={isTaskDone}
    >
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

            {config.helperText ? (
              <p>{config.helperText}</p>
            ) : null}
          </div>
        </aside>

        <section className="sequence-order-list" aria-label="Sortable steps">
          {items.map((item, index) => {
            const resultClass = '';

            return (
              <div
                key={item.id}
                className={`sequence-order-row ${resultClass}`}
                draggable={!checking}
                onDragStart={(event) => handleDragStart(event, item.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleDrop(event, item.id)}
              >
                <div className="sequence-order-number">
                  {index + 1}
                </div>

                <button
                  type="button"
                  className="sequence-order-block"
                  onClick={() => moveDown(item.id)}
                  title="Click to move down"
                  disabled={checking}
                >
                  {item.text}
                </button>

                <div className="sequence-order-controls">
                  <button
                    type="button"
                    onClick={() => moveUp(item.id)}
                    aria-label="Move up"
                    disabled={checking}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDown(item.id)}
                    aria-label="Move down"
                    disabled={checking}
                  >
                    ↓
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      </article>
    </LmsActivityFrame>
  );
}