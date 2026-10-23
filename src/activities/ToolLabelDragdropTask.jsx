import { useEffect, useMemo, useState } from 'react';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import {
  loadLocalTaskState,
  saveLocalTaskState,
} from '../lib/taskExtractors.js';
import './ToolLabelDragdropTask.css';

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTaskId(task) {
  return String(task?.id || task?.taskId || '').trim();
}

function getConfig(task) {
  const config =
    task?.toolLabelDragdrop ||
    task?.tool_label_dragdrop ||
    task?.renderer?.toolLabelDragdrop ||
    task?.renderer?.tool_label_dragdrop ||
    {};

  return {
    title:
      normalizeText(config.title) ||
      normalizeText(task?.title) ||
      'Fill in the blanks with the correct names of the instruments.',
    helperText: normalizeText(config.helperText || config.helper_text || ''),
    attempt: normalizeText(config.attempt || task?.attempt || 'Attempt: 1/2'),
    items: Array.isArray(config.items)
      ? config.items
      : [
          { id: 'rotate', text: 'Rotate' },
          { id: 'scale', text: 'Scale' },
          { id: 'move', text: 'Move' },
        ],
    slots: Array.isArray(config.slots)
      ? config.slots
      : [
          { id: 'move-slot', icon: 'move', answer: 'Move' },
          { id: 'scale-slot', icon: 'scale', answer: 'Scale' },
          { id: 'rotate-slot', icon: 'rotate', answer: 'Rotate' },
        ],
    answerKey: config.answerKey || config.answer_key || {
      'move-slot': 'Move',
      'scale-slot': 'Scale',
      'rotate-slot': 'Rotate',
    },
  };
}

function getInitialPlaced(slots) {
  const result = {};
  slots.forEach((slot) => {
    result[slot.id] = '';
  });
  return result;
}

function getIcon(icon) {
  if (icon === 'move') return '↔';
  if (icon === 'scale') return '↗';
  if (icon === 'rotate') return '↻';
  return '?';
}

export default function ToolLabelDragdropTask({
  task,
  onPrevTask,
  onNextTask,
  isTaskDone,
}) {
  const data = useMemo(() => getConfig(task), [task]);

  const storageKey = useMemo(
    () => `tool-label-dragdrop:${getTaskId(task) || 'default'}`,
    [task],
  );

  const saved = useMemo(() => loadLocalTaskState(storageKey, null), [storageKey]);

  const [placed, setPlaced] = useState(() => ({
    ...getInitialPlaced(data.slots),
    ...(saved?.placed || {}),
  }));

  const [status, setStatus] = useState(saved?.status || '');
  const [draggedItemId, setDraggedItemId] = useState('');

  useEffect(() => {
    const nextSaved = loadLocalTaskState(storageKey, null);

    setPlaced({
      ...getInitialPlaced(data.slots),
      ...(nextSaved?.placed || {}),
    });

    setStatus(nextSaved?.status || '');
  }, [storageKey, data.slots]);

  useEffect(() => {
    saveLocalTaskState(storageKey, {
      placed,
      status,
    });
  }, [storageKey, placed, status]);

  const usedItemIds = useMemo(() => {
    return new Set(Object.values(placed).filter(Boolean));
  }, [placed]);

  const availableItems = useMemo(() => {
    return data.items.filter((item) => !usedItemIds.has(item.id));
  }, [data.items, usedItemIds]);

  function getItemText(itemId) {
    return data.items.find((item) => item.id === itemId)?.text || '';
  }

  function onDragStart(event, itemId) {
    setDraggedItemId(itemId);
    event.dataTransfer.setData('text/plain', itemId);
    event.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  function onDrop(event, slotId) {
    event.preventDefault();

    const itemId =
      event.dataTransfer.getData('text/plain') ||
      draggedItemId;

    if (!itemId) return;

    setPlaced((current) => {
      const next = { ...current };

      Object.keys(next).forEach((key) => {
        if (next[key] === itemId) {
          next[key] = '';
        }
      });

      next[slotId] = itemId;
      return next;
    });

    setStatus('');
    setDraggedItemId('');
  }

  function removeFromSlot(slotId) {
    setPlaced((current) => ({
      ...current,
      [slotId]: '',
    }));

    setStatus('');
  }

  function resetAnswer() {
    setPlaced(getInitialPlaced(data.slots));
    setStatus('');
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

  function checkAnswer() {
    const hasEmpty = data.slots.some((slot) => !placed[slot.id]);

    if (hasEmpty) {
      setStatus('Please fill in all blanks.');
      return;
    }

    const allCorrect = data.slots.every((slot) => {
      const placedText = normalizeText(getItemText(placed[slot.id])).toLowerCase();
      const expectedText = normalizeText(data.answerKey[slot.id] || slot.answer).toLowerCase();

      return placedText === expectedText;
    });

    setStatus(allCorrect ? 'Correct!' : 'Try again.');
    if (allCorrect) {
      triggerSuccess();
    }
  }

  return (
    <LmsActivityFrame
      title={data.title}
      status={status}
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
      onCheck={checkAnswer}
      onReset={resetAnswer}
      isTaskDone={isTaskDone}
    >
      <article className="tool-label-task">
        <h2 className="tool-label-title">{data.title}</h2>

        {data.helperText ? (
          <p className="tool-label-helper">{data.helperText}</p>
        ) : null}

        <section className="tool-label-board">
          <div className="tool-label-bank">
            {availableItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="tool-label-card"
                draggable
                onDragStart={(event) => onDragStart(event, item.id)}
              >
                {item.text}
              </button>
            ))}
          </div>

          <div className="tool-label-panel">
            <div className="tool-label-icons">
              {data.slots.map((slot) => (
                <div key={slot.id} className="tool-label-icon-column">
                  <div className={`tool-label-icon is-${slot.icon}`}>
                    {getIcon(slot.icon)}
                  </div>

                  <div
                    className={`tool-label-drop ${placed[slot.id] ? 'has-value' : ''}`}
                    onDragOver={onDragOver}
                    onDrop={(event) => onDrop(event, slot.id)}
                  >
                    {placed[slot.id] ? (
                      <button
                        type="button"
                        className="tool-label-placed"
                        onClick={() => removeFromSlot(slot.id)}
                        draggable
                        onDragStart={(event) => onDragStart(event, placed[slot.id])}
                      >
                        {getItemText(placed[slot.id])}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </article>
    </LmsActivityFrame>
  );
}