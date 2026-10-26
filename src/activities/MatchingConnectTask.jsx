import { useEffect, useMemo, useRef, useState } from 'react';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import './MatchingConnectTask.css';
import { getUniqueImages, loadLocalTaskState, saveLocalTaskState } from '../lib/taskExtractors.js';

const DEFAULT_COLORS = [
  '#22c55e',
  '#22c55e',
  '#67d9eb',
  '#f472e9',
  '#f97316',
  '#22c55e',
  '#3b82f6',
  '#ef4444',
];

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeImage(rawImage) {
  if (!rawImage) return null;

  if (typeof rawImage === 'string') {
    return {
      src: rawImage,
      alt: '',
    };
  }

  const src =
    rawImage.src ||
    rawImage.url ||
    rawImage.path ||
    rawImage.href ||
    rawImage.file ||
    rawImage.asset ||
    rawImage.assetPath ||
    '';

  if (!src) return null;

  return {
    src,
    alt: normalizeText(rawImage.alt || rawImage.title || rawImage.label || ''),
  };
}

function normalizeItem(item, index, side) {
  if (typeof item === 'string') {
    return {
      id: `${side}-${index + 1}`,
      text: normalizeText(item),
      image: null,
      useCapturedImageIndex: null,
      alt: '',
    };
  }

  return {
    ...item,
    id: String(item?.id || `${side}-${index + 1}`),
    text: normalizeText(item?.text || item?.label || item?.title || ''),
    image: normalizeImage(item?.image || item?.img || item?.picture || item?.src || null),
    useCapturedImageIndex:
      item?.useCapturedImageIndex ??
      item?.capturedImageIndex ??
      item?.imageIndex ??
      null,
    alt: normalizeText(item?.alt || item?.imageAlt || ''),
  };
}

function getRouteKey() {
  try {
    const params = new URLSearchParams(window.location.search);
    const courseId = params.get('course') || 'catalog';
    const lessonId = params.get('lesson') || 'course-home';
    const pageId = params.get('page') || '';
    return `${courseId}:${lessonId}:${pageId}`;
  } catch {
    return 'catalog:course-home';
  }
}

function getTaskKey(task) {
  return (
    task?.id ||
    task?.taskId ||
    task?.key ||
    task?.title ||
    task?.matchingConnect?.title ||
    'matching-connect-task'
  );
}

function getStorageKey(task) {
  return `lms-replica:matching-connect:${getRouteKey()}:${getTaskKey(task)}`;
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getMatchingSource(task, state) {
  return (
    state?.matchingConnect ||
    state?.matching_connect ||
    state?.renderer?.matchingConnect ||
    state?.renderer?.matching_connect ||
    task?.matchingConnect ||
    task?.matching_connect ||
    task?.renderer?.matchingConnect ||
    task?.renderer?.matching_connect ||
    {}
  );
}

function getMatchingData(task, state) {
  const data = getMatchingSource(task, state);

  return {
    title: normalizeText(data.title || task?.title || ''),
    helperText: normalizeText(data.helperText || data.helper_text || ''),
    attempt: normalizeText(data.attempt || task?.attempt || 'Attempt: 1/2'),
    checkMode: data.checkMode || data.check_mode || 'answer-key',
    leftItems: Array.isArray(data.leftItems)
      ? data.leftItems.map((item, index) => normalizeItem(item, index, 'left'))
      : [],
    rightItems: Array.isArray(data.rightItems)
      ? data.rightItems.map((item, index) => normalizeItem(item, index, 'right'))
      : [],
    answerKey: data.answerKey || data.answer_key || {},
  };
}

function getConnectionColor(leftItems, leftId) {
  const index = leftItems.findIndex((item) => item.id === leftId);
  return DEFAULT_COLORS[Math.max(0, index) % DEFAULT_COLORS.length];
}

function invertConnections(connections) {
  const result = {};

  Object.entries(connections || {}).forEach(([leftId, rightId]) => {
    if (!rightId) return;
    result[rightId] = leftId;
  });

  return result;
}

function isComplete(connections, leftItems) {
  return leftItems.every((item) => connections[item.id]);
}

function isCorrect(connections, answerKey, leftItems) {
  return leftItems.every((item) => connections[item.id] === answerKey[item.id]);
}

function resolveCapturedImageItem(item, capturedImages) {
  if (item.image?.src) return item;

  const index = Number(item.useCapturedImageIndex);

  if (Number.isFinite(index) && capturedImages[index]?.src) {
    return {
      ...item,
      image: {
        src: capturedImages[index].src,
        alt: item.alt || capturedImages[index].alt || item.text || '',
      },
    };
  }

  return item;
}

function MatchingItemContent({ item }) {
  if (item?.image?.src) {
    return (
      <img
        className="matching-connect-item-image"
        src={item.image.src}
        alt={item.image.alt || item.alt || item.text || ''}
        draggable={false}
      />
    );
  }

  return item?.text || item?.alt || '';
}

export default function MatchingConnectTask({
  task = {},
  state = null,
  onComplete,
  onPrevTask,
  onNextTask,
  isTaskDone,
}) {
  const rawData = useMemo(() => getMatchingData(task, state), [task, state]);
  const capturedImages = useMemo(() => getUniqueImages(task), [task]);

  const data = useMemo(() => {
    const leftItems = rawData.leftItems.map((item) => (
      resolveCapturedImageItem(item, capturedImages)
    ));

    return {
      ...rawData,
      leftItems,
    };
  }, [rawData, capturedImages]);

  const taskId = getTaskKey(task);
  const storageKey = taskId;

  const [connections, setConnections] = useState(() => {
    const saved = loadLocalTaskState(taskId, null);
    if (saved?.connections && Object.keys(saved.connections).length > 0) {
      return saved.connections;
    }
    if (isTaskDone && data.answerKey && Object.keys(data.answerKey).length > 0) {
      return data.answerKey;
    }
    return {};
  });
  const [activeLeftId, setActiveLeftId] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [previewLine, setPreviewLine] = useState(null);
  const [checked, setChecked] = useState(() => {
    const saved = loadLocalTaskState(taskId, null);
    return Boolean(saved?.checked);
  });
  const [result, setResult] = useState(() => {
    const saved = loadLocalTaskState(taskId, null);
    return saved?.result || null;
  });
  const [lineLayout, setLineLayout] = useState({});

  const boardRef = useRef(null);
  const leftDotRefs = useRef({});
  const rightDotRefs = useRef({});

  const rightToLeft = useMemo(() => invertConnections(connections), [connections]);

  const rows = useMemo(() => {
    const count = Math.max(data.leftItems.length, data.rightItems.length);

    return Array.from({ length: count }, (_, index) => ({
      index,
      leftItem: data.leftItems[index] || null,
      rightItem: data.rightItems[index] || null,
    }));
  }, [data.leftItems, data.rightItems]);

  useEffect(() => {
    saveLocalTaskState(taskId, {
      connections,
      checked,
      result,
    });
  }, [taskId, connections, checked, result]);

  function getDotCenter(dot, board) {
    if (!dot || !board) return null;

    const dotRect = dot.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();

    return {
      x: dotRect.left + dotRect.width / 2 - boardRect.left,
      y: dotRect.top + dotRect.height / 2 - boardRect.top,
    };
  }

  function updateLines() {
    const board = boardRef.current;
    if (!board) return;

    const nextLayout = {};

    Object.entries(connections).forEach(([leftId, rightId]) => {
      const leftCenter = getDotCenter(leftDotRefs.current[leftId], board);
      const rightCenter = getDotCenter(rightDotRefs.current[rightId], board);

      if (!leftCenter || !rightCenter) return;

      nextLayout[leftId] = {
        x1: leftCenter.x,
        y1: leftCenter.y,
        x2: rightCenter.x,
        y2: rightCenter.y,
      };
    });

    setLineLayout(nextLayout);
  }

  useEffect(() => {
    updateLines();

    window.addEventListener('resize', updateLines);

    const raf = requestAnimationFrame(updateLines);
    const timeout = window.setTimeout(updateLines, 150);

    return () => {
      window.removeEventListener('resize', updateLines);
      cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
    };
  }, [connections, data.leftItems, data.rightItems]);

  function clearResultState() {
    setChecked(false);
    setResult(null);
  }

  function updatePreviewLine(leftId, clientX, clientY) {
    const board = boardRef.current;
    const leftDot = leftDotRefs.current[leftId];

    if (!board || !leftDot) return;

    const leftCenter = getDotCenter(leftDot, board);
    const boardRect = board.getBoundingClientRect();

    if (!leftCenter) return;

    setPreviewLine({
      leftId,
      x1: leftCenter.x,
      y1: leftCenter.y,
      x2: clientX - boardRect.left,
      y2: clientY - boardRect.top,
      color: getConnectionColor(data.leftItems, leftId),
    });
  }

  function connectItems(leftId, rightId) {
    if (!leftId || !rightId) return;

    clearResultState();

    setConnections((current) => {
      const next = { ...current };

      Object.entries(next).forEach(([existingLeftId, existingRightId]) => {
        if (existingRightId === rightId) {
          delete next[existingLeftId];
        }
      });

      next[leftId] = rightId;

      return next;
    });

    setActiveLeftId(null);
    setIsDragging(false);
    setPreviewLine(null);

    window.setTimeout(updateLines, 0);
  }

  function removeConnection(leftId) {
    clearResultState();

    setConnections((current) => {
      const next = { ...current };
      delete next[leftId];
      return next;
    });

    if (activeLeftId === leftId) {
      setActiveLeftId(null);
    }

    setPreviewLine(null);
  }

  function handleLeftPillClick(leftId) {
    clearResultState();
    setActiveLeftId((current) => (current === leftId ? null : leftId));
    setIsDragging(false);
    setPreviewLine(null);
  }

  function handleLeftDotPointerDown(event, leftId) {
    event.preventDefault();

    clearResultState();

    if (connections[leftId]) {
      removeConnection(leftId);
    }

    setActiveLeftId(leftId);
    setIsDragging(true);
    updatePreviewLine(leftId, event.clientX, event.clientY);
  }

  function handleRightClick(rightId) {
    if (!activeLeftId) return;
    connectItems(activeLeftId, rightId);
  }

  useEffect(() => {
    if (!isDragging || !activeLeftId) return undefined;

    function handlePointerMove(event) {
      updatePreviewLine(activeLeftId, event.clientX, event.clientY);
    }

    function handlePointerUp(event) {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const rightTarget = element?.closest?.('[data-matching-right-id]');
      const rightId = rightTarget?.getAttribute('data-matching-right-id');

      if (rightId) {
        connectItems(activeLeftId, rightId);
        return;
      }

      setIsDragging(false);
      setPreviewLine(null);
    }

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);

    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isDragging, activeLeftId, data.leftItems]);

  function handleReset() {
    setConnections({});
    setActiveLeftId(null);
    setIsDragging(false);
    setPreviewLine(null);
    setChecked(false);
    setResult(null);
    localStorage.removeItem(storageKey);
  }

  function handleCheck() {
    const complete = isComplete(connections, data.leftItems);

    if (!complete) {
      setChecked(true);
      setResult('incomplete');
      return;
    }

    const correct =
      data.checkMode === 'answer-key'
        ? isCorrect(connections, data.answerKey, data.leftItems)
        : true;

    setChecked(true);
    setResult(correct ? 'correct' : 'wrong');

    if (correct) {
      window.dispatchEvent(
        new CustomEvent('LMS_TASK_COMPLETED', {
          detail: { taskId: task?.id || task?.taskId },
        })
      );
      if (typeof onComplete === 'function') {
        onComplete(task);
      }
    }
  }

  const hasData = data.leftItems.length > 0 && data.rightItems.length > 0;

  if (!hasData) {
    return (
      <section className="matching-connect-stage">
        <div className="matching-connect-card">
          <h1 className="matching-connect-title">
            {data.title || 'Matching connect task'}
          </h1>
          <p className="matching-connect-empty">
            Missing matchingConnect.leftItems or matchingConnect.rightItems.
          </p>
        </div>
      </section>
    );
  }

  const isDone = Boolean(isTaskDone || (checked && result === 'correct'));
  const feedbackStatus = checked
    ? (result === 'correct' ? 'Correct!' : result === 'wrong' ? 'Some connections are incorrect.' : 'Please connect all items before checking.')
    : (isDone ? 'Correct!' : '');

  return (
    <LmsActivityFrame
      title={data.title}
      status={feedbackStatus}
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
      onCheck={handleCheck}
      onReset={handleReset}
      isTaskDone={isDone}
    >
      <section className="matching-connect-stage">
        <div className="matching-connect-card">
        <div className="matching-connect-header">
          <div className="matching-connect-heading">
            <h1 className="matching-connect-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {isDone && (
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
              <span>{data.title}</span>
            </h1>

            {data.helperText ? (
              <p className="matching-connect-helper">{data.helperText}</p>
            ) : null}
          </div>
        </div>

        <div className="matching-connect-board" ref={boardRef}>
          <svg className="matching-connect-lines" aria-hidden="true">
            {Object.entries(connections).map(([leftId, rightId]) => {
              const layout = lineLayout[leftId];
              if (!layout) return null;

              const color = getConnectionColor(data.leftItems, leftId);
              const wrong =
                checked &&
                result === 'wrong' &&
                data.answerKey[leftId] &&
                data.answerKey[leftId] !== rightId;

              return (
                <line
                  key={`${leftId}-${rightId}`}
                  x1={layout.x1}
                  y1={layout.y1}
                  x2={layout.x2}
                  y2={layout.y2}
                  className={wrong ? 'matching-connect-line is-wrong' : 'matching-connect-line'}
                  stroke={wrong ? '#ef4444' : color}
                />
              );
            })}

            {previewLine ? (
              <line
                x1={previewLine.x1}
                y1={previewLine.y1}
                x2={previewLine.x2}
                y2={previewLine.y2}
                className="matching-connect-line is-preview"
                stroke={previewLine.color}
              />
            ) : null}
          </svg>

          {rows.map(({ index, leftItem, rightItem }) => {
            const leftId = leftItem?.id || '';
            const rightId = rightItem?.id || '';

            const connectedRightId = leftId ? connections[leftId] : '';
            const connectedLeftId = rightId ? rightToLeft[rightId] : '';

            const leftColor = leftId
              ? getConnectionColor(data.leftItems, leftId)
              : '#cbd5e1';

            const rightColor = connectedLeftId
              ? getConnectionColor(data.leftItems, connectedLeftId)
              : '#cbd5e1';

            const leftActive = activeLeftId === leftId;
            const leftConnected = Boolean(connectedRightId);
            const rightConnected = Boolean(connectedLeftId);

            const leftWrong =
              checked &&
              result === 'wrong' &&
              data.answerKey[leftId] &&
              data.answerKey[leftId] !== connectedRightId;

            return (
              <div className="matching-connect-row" key={`row-${index}`}>
                <div className="matching-connect-left-cell">
                  {leftItem ? (
                    <button
                      type="button"
                      className={[
                        'matching-connect-pill',
                        'matching-connect-left-pill',
                        leftItem.image?.src ? 'has-image' : '',
                        leftActive ? 'is-active' : '',
                        leftConnected ? 'is-connected' : '',
                        leftWrong ? 'is-wrong' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => handleLeftPillClick(leftId)}
                    >
                      <MatchingItemContent item={leftItem} />
                    </button>
                  ) : null}
                </div>

                <div className="matching-connect-left-dot-cell">
                  {leftItem ? (
                    <button
                      type="button"
                      className={[
                        'matching-connect-dot',
                        'matching-connect-left-dot',
                        leftActive ? 'is-active' : '',
                        leftConnected ? 'is-connected' : '',
                        leftWrong ? 'is-wrong' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{ '--dot-color': leftColor }}
                      ref={(node) => {
                        if (node) leftDotRefs.current[leftId] = node;
                      }}
                      onPointerDown={(event) => handleLeftDotPointerDown(event, leftId)}
                      aria-label={`Connect ${leftItem.text || leftItem.alt || leftId}`}
                    />
                  ) : null}
                </div>

                <div className="matching-connect-middle-cell" />

                <div className="matching-connect-right-dot-cell">
                  {rightItem ? (
                    <button
                      type="button"
                      data-matching-right-id={rightId}
                      className={[
                        'matching-connect-dot',
                        'matching-connect-right-dot',
                        rightConnected ? 'is-connected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{ '--dot-color': rightColor }}
                      ref={(node) => {
                        if (node) rightDotRefs.current[rightId] = node;
                      }}
                      onClick={() => handleRightClick(rightId)}
                      aria-label={`Connect to ${rightItem.text}`}
                    />
                  ) : null}
                </div>

                <div className="matching-connect-right-cell">
                  {rightItem ? (
                    <button
                      type="button"
                      data-matching-right-id={rightId}
                      className={[
                        'matching-connect-pill',
                        'matching-connect-right-pill',
                        rightConnected ? 'is-connected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => handleRightClick(rightId)}
                    >
                      <MatchingItemContent item={rightItem} />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {checked && result ? (
          <div
            className={[
              'matching-connect-feedback',
              result === 'correct' ? 'is-correct' : '',
              result === 'wrong' ? 'is-wrong' : '',
              result === 'incomplete' ? 'is-incomplete' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {result === 'correct'
              ? 'Correct!'
              : result === 'wrong'
                ? 'Some connections are incorrect.'
                : 'Connect all items before checking.'}
          </div>
        ) : null}

      </div>
    </section>
  </LmsActivityFrame>
);
}