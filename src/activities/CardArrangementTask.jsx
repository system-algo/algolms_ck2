import { useEffect, useMemo, useState } from 'react';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import { loadLocalTaskState, saveLocalTaskState } from '../lib/taskExtractors.js';
import {
  getTaskId,
  notifyTaskCompleted,
  submitGradedAttempt,
  useManualTaskConfig,
} from '../lib/ck2TaskRuntime.js';
import './CardArrangementTask.css';

/**
 * CardArrangementTask — the "combinatorics" steps of the real platform
 * (math-combinatorics): put cards into numbered slots in the right order.
 * Tap a card to put it in the first empty slot; tap a placed card to take it back.
 *
 * Map config (tasks[taskId].cardArrangement):
 * { title, slots, cards: [{ id, src, alt }], answer: [cardId, ...] }
 *
 * Backend contract (same as sequence-order-task):
 *   answer = { itemOrder: [...], order: [...] }
 */

const ACTIVITY_TYPE = 'sequence-order-task';

function normalizeConfig(raw) {
  const config = raw || {};
  const cards = (config.cards || []).map((card, index) => ({ ...card, id: String(card.id || index + 1) }));
  const answer = (config.answer || []).map(String);
  return {
    title: String(config.title || '').trim(),
    cards,
    answer,
    slots: Number(config.slots) || answer.length || cards.length,
  };
}

export default function CardArrangementTask({
  task,
  pageInstance,
  onPrevTask,
  onNextTask,
  onTaskCompleted,
  onTaskComplete,
  isTaskDone = false,
}) {
  const taskId = getTaskId(task);
  const storageKey = `card-arrangement-${taskId}`;

  const rawConfig = useManualTaskConfig(task, pageInstance, ['cardArrangement']) || task?.cardArrangement || null;
  const data = useMemo(() => normalizeConfig(rawConfig), [rawConfig]);
  const { cards, answer, slots } = data;
  const hasData = cards.length > 0 && answer.length > 0;

  const [placed, setPlaced] = useState([]); // array of card ids, index = slot
  const [status, setStatus] = useState('');
  const [hasError, setHasError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const isSolved = Boolean(isTaskDone || confirmed);

  useEffect(() => {
    if (!hasData) return;
    if (isTaskDone) {
      setPlaced([...answer]);
      return;
    }
    const saved = loadLocalTaskState(storageKey, null);
    const valid = new Set(cards.map((card) => card.id));
    const list = Array.isArray(saved?.placed) ? saved.placed.filter((id) => valid.has(id)) : [];
    setPlaced([...new Set(list)].slice(0, slots));
  }, [hasData, isTaskDone, storageKey, cards, answer, slots]);

  useEffect(() => {
    if (!hasData || isSolved) return;
    saveLocalTaskState(storageKey, { placed });
  }, [hasData, isSolved, storageKey, placed]);

  const cardById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const trayCards = cards.filter((card) => !placed.includes(card.id));

  function addCard(id) {
    if (isSolved || checking || placed.length >= slots) return;
    setPlaced((current) => [...current, id]);
    setStatus('');
    setHasError(false);
  }

  function removeCard(id) {
    if (isSolved || checking) return;
    setPlaced((current) => current.filter((item) => item !== id));
    setStatus('');
    setHasError(false);
  }

  function resetTask() {
    if (isSolved || checking) return;
    setPlaced([]);
    setStatus('');
    setHasError(false);
  }

  async function checkTask() {
    if (isSolved || checking || !hasData) return;

    if (placed.length < answer.length) {
      setStatus(`Please fill all the places first (${placed.length}/${answer.length})`);
      setHasError(true);
      return;
    }

    if (placed.length !== answer.length || placed.some((id, index) => id !== answer[index])) {
      setStatus('Almost there! Try again.');
      setHasError(true);
      return;
    }

    setChecking(true);
    setStatus('Saving your answer...');
    setHasError(false);

    const payload = { itemOrder: [...placed], order: [...placed] };

    try {
      await submitGradedAttempt({ task, pageInstance, activityType: ACTIVITY_TYPE, answer: payload });
      setConfirmed(true);
      setStatus('Correct!');
      notifyTaskCompleted({
        task,
        pageInstance,
        activityType: ACTIVITY_TYPE,
        metadata: { order: [...placed] },
        onTaskCompleted,
        onTaskComplete,
        onNextTask,
      });
    } catch (error) {
      console.warn('[CardArrangementTask] Could not save CK2 answer:', error);
      setStatus('Could not save or verify your answer. Please try again.');
      setHasError(true);
    } finally {
      setChecking(false);
    }
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
      <article className="card-arrangement-task">
        <h1 className={`card-arrangement-title ${isSolved ? 'is-solved' : ''}`}>
          {isSolved && <span className="card-arrangement-badge">✓</span>}
          {data.title}
        </h1>

        {!hasData ? (
          <div className="card-arrangement-empty">This activity is not set up yet.</div>
        ) : (
          <>
            <div className="card-arrangement-slots">
              {Array.from({ length: slots }).map((_, index) => {
                const card = cardById.get(placed[index]);
                const wrong = hasError && card && placed.length >= answer.length && card.id !== answer[index];
                return (
                  <button
                    key={index}
                    type="button"
                    className={['card-arrangement-slot', card ? 'is-filled' : '', wrong ? 'is-wrong' : '', isSolved ? 'is-right' : '']
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => card && removeCard(card.id)}
                    disabled={!card || isSolved || checking}
                    aria-label={card ? `Place ${index + 1}: ${card.alt || card.id}` : `Empty place ${index + 1}`}
                  >
                    <span className="card-arrangement-slot-number">{index + 1}</span>
                    {card && <img src={card.src} alt={card.alt || ''} draggable={false} />}
                  </button>
                );
              })}
            </div>

            <div className="card-arrangement-tray">
              {trayCards.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  className="card-arrangement-card"
                  onClick={() => addCard(card.id)}
                  disabled={isSolved || checking}
                  aria-label={card.alt || `Card ${card.id}`}
                >
                  <img src={card.src} alt={card.alt || ''} draggable={false} />
                </button>
              ))}
            </div>
          </>
        )}
      </article>
    </LmsActivityFrame>
  );
}
