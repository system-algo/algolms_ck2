import { useEffect, useMemo, useState } from 'react';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import {
  loadLocalTaskState,
  saveLocalTaskState,
} from '../lib/taskExtractors.js';

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n\s+\n/g, '\n');
}

function unique(values) {
  const seen = new Set();
  const result = [];

  values.forEach((value) => {
    const text = normalizeText(value);
    if (!text) return;

    const key = text.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    result.push(text);
  });

  return result;
}

function collectAllStrings(value, output = [], depth = 0) {
  if (depth > 14 || value == null) return output;

  if (typeof value === 'string') {
    const text = value.trim();
    if (text) output.push(text);
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectAllStrings(item, output, depth + 1));
    return output;
  }

  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectAllStrings(item, output, depth + 1));
  }

  return output;
}

function splitLines(value) {
  return stripHtml(value)
    .replace(/\r/g, '\n')
    .split('\n')
    .map(normalizeText)
    .filter(Boolean);
}

function isTechnicalCaptureLine(line) {
  const text = String(line || '').trim();
  const lower = normalizeLower(text);

  if (!text) return false;

  if (lower.includes('nth-of-type')) return true;
  if (lower.includes('queryselector')) return true;
  if (lower.includes('dom path')) return true;
  if (lower.includes('css selector')) return true;
  if (lower.includes('.sc-')) return true;

  if (
    /(^|\s)(div|span|button|input|textarea|section|article|aside|main|p|pre)\.[a-z0-9_-]+/i.test(text) &&
    (text.includes('>') || text.includes(':nth-'))
  ) {
    return true;
  }

  if (text.length > 100 && text.includes('>') && text.includes('.')) {
    return true;
  }

  return false;
}

function isNoiseLine(line) {
  const lower = normalizeLower(line);

  if (!lower) return true;
  if (isTechnicalCaptureLine(line)) return true;

  if (lower === 'run') return true;
  if (lower === 'reset') return true;
  if (lower === 'check') return true;
  if (lower === 'next') return true;
  if (lower === 'show raw capture') return true;
  if (lower === 'use activity renderer') return true;
  if (lower === 'tasks with automatic check') return true;
  if (lower === 'task with automatic check') return true;

  if (lower.includes('output will appear')) return true;
  if (lower.includes('write your code here')) return true;
  if (lower.includes('task-preview')) return true;
  if (lower.includes('screenshots/')) return true;
  if (lower.includes('assets/')) return true;
  if (lower.includes('generated/')) return true;

  return false;
}

function looksLikeCodeLine(line) {
  const text = normalizeText(line);

  if (isNoiseLine(text)) return false;

  return (
    /^[a-zA-Z_][\w]*\s*=\s*.*$/.test(text) ||
    /^print\s*\(.*/.test(text) ||
    /^input\s*\(.*/.test(text) ||
    /^if\s+.+/.test(text) ||
    /^elif\s+.+/.test(text) ||
    /^else\s*:/.test(text) ||
    /^for\s+.+/.test(text) ||
    /^while\s+.+/.test(text) ||
    /^return\s+.+/.test(text) ||
    /^import\s+.+/.test(text) ||
    /^from\s+.+\s+import\s+.+/.test(text) ||
    /^def\s+.+/.test(text)
  );
}

function getAllCleanLines(source) {
  return unique(collectAllStrings(source).flatMap(splitLines))
    .filter((line) => !isNoiseLine(line));
}

function getPrompt(lines, task, state) {
  return (
    lines.find((line) => /determine whether/i.test(line)) ||
    lines.find((line) => /match/i.test(line) && /categor/i.test(line)) ||
    state?.codeTypingPrompt ||
    task?.codeTypingPrompt ||
    task?.title ||
    'Classify the code snippets.'
  );
}

function getCategories(lines) {
  const categories = [];

  lines.forEach((line) => {
    const lower = normalizeLower(line);

    if (lower === 'there is an error') categories.push('There is an error');
    if (lower === 'no error') categories.push('No error');

    if (lower.includes('there is an error')) categories.push('There is an error');
    if (lower.includes('no error')) categories.push('No error');

    if (lower.includes('prints the string')) categories.push('The program prints the string');
    if (lower.includes('prints a number')) categories.push('The program prints a number');
    if (lower.includes('displays an error')) categories.push('The interpreter displays an error');
  });

  const result = unique(categories);

  if (result.length >= 2) return result;

  return ['There is an error', 'No error'];
}

function shouldStartNewBlock(currentLines, nextLine) {
  if (!currentLines.length) return false;

  const next = normalizeText(nextLine);
  const nextLooksAssignment = /^[a-zA-Z_][\w]*\s*=/.test(next);
  const currentHasEnough = currentLines.length >= 2;
  const currentHasPrint = currentLines.some((line) => /^print\s*\(/.test(line));

  if (currentHasPrint && nextLooksAssignment) return true;
  if (currentHasEnough && nextLooksAssignment) return true;

  return false;
}

function extractTextCodeBlocks(lines) {
  const blocks = [];
  let current = [];

  lines.forEach((line) => {
    const text = normalizeText(line);

    if (!looksLikeCodeLine(text)) {
      if (current.length) {
        blocks.push(current.join('\n'));
        current = [];
      }
      return;
    }

    if (shouldStartNewBlock(current, text)) {
      blocks.push(current.join('\n'));
      current = [];
    }

    current.push(text);
  });

  if (current.length) {
    blocks.push(current.join('\n'));
  }

  return unique(blocks)
    .filter((block) => block.split('\n').filter(Boolean).length >= 2)
    .slice(0, 12);
}

function getImageCardsFromState(state) {
  const explicit =
    state?.snippetImages ||
    state?.codeSnippetImages ||
    state?.imageCards ||
    state?.croppedCards ||
    [];

  if (Array.isArray(explicit) && explicit.length > 0) {
    return explicit
      .map((item, index) => ({
        id: item.id || `image-card-${index + 1}`,
        type: 'image',
        image: item.image || item.src || item.url || item.path,
        crop: item.crop || null,
      }))
      .filter((item) => item.image);
  }

  const screenshot =
    state?.screenshot ||
    state?.screenshotFile ||
    state?.image ||
    '';

  if (!screenshot) return [];

  const rects = [
    { x: 0.205, y: 0.300, w: 0.245, h: 0.150 },
    { x: 0.490, y: 0.300, w: 0.245, h: 0.150 },
    { x: 0.205, y: 0.465, w: 0.245, h: 0.150 },
    { x: 0.490, y: 0.465, w: 0.245, h: 0.150 },
  ];

  return rects.map((crop, index) => ({
    id: `image-card-${index + 1}`,
    type: 'image',
    image: screenshot,
    crop,
  }));
}

function getTaskData(task, state) {
  const source = state || task;
  const lines = getAllCleanLines(source);
  const categories = getCategories(lines);
  const textBlocks = extractTextCodeBlocks(lines);

  const textCards = textBlocks.map((code, index) => ({
    id: `text-card-${index + 1}`,
    type: 'text',
    code,
  }));

  const imageCards = getImageCardsFromState(state);

  return {
    prompt: getPrompt(lines, task, state),
    categories,
    cards: textCards.length > 0 ? textCards : imageCards,
  };
}

function CropImageCard({ card }) {
  if (!card.crop) {
    return (
      <div className="classification-image-card">
        <img src={card.image} alt="Code snippet" />
      </div>
    );
  }

  const crop = card.crop;

  return (
    <div
      className="classification-crop-image"
      style={{
        '--crop-x': crop.x,
        '--crop-y': crop.y,
        '--crop-w': crop.w,
        '--crop-h': crop.h,
      }}
    >
      <img src={card.image} alt="Code snippet crop" />
    </div>
  );
}

function CardPreview({ card }) {
  if (card.type === 'image') {
    return <CropImageCard card={card} />;
  }

  return <pre>{card.code}</pre>;
}

export default function CodeClassificationTask({
  task,
  state,
  onPrevTask,
  onNextTask,
  onPrevState,
  onNextState,
  isTaskDone,
}) {
  const data = useMemo(() => getTaskData(task, state), [task, state]);

  const taskId = String(task?.id || task?.taskId || 'classification').trim();
  const storageKey = `${taskId}:${state?.id || state?.stateId || 'classification'}:drag-v1`;
  const saved = loadLocalTaskState(storageKey, null);

  const [placements, setPlacements] = useState(saved?.placements || {});
  const [draggingId, setDraggingId] = useState('');
  const [status, setStatus] = useState(saved?.status || '');

  const nextAction = onNextState || onNextTask;
  const prevAction = onPrevState || onPrevTask;

  useEffect(() => {
    saveLocalTaskState(storageKey, { placements, status });
  }, [storageKey, placements, status]);

  function placeCard(cardId, category) {
    setPlacements((current) => ({
      ...current,
      [cardId]: category,
    }));
    setStatus('');
  }

  function unplaceCard(cardId) {
    setPlacements((current) => {
      const next = { ...current };
      delete next[cardId];
      return next;
    });
    setStatus('');
  }

  function handleDragStart(event, cardId) {
    setDraggingId(cardId);
    event.dataTransfer.setData('text/plain', cardId);
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleDrop(event, category) {
    event.preventDefault();

    const cardId = event.dataTransfer.getData('text/plain') || draggingId;

    if (!cardId) return;

    placeCard(cardId, category);
    setDraggingId('');
  }

  function reset() {
    setPlacements({});
    setDraggingId('');
    setStatus('');
  }

  function triggerSuccess() {
    window.dispatchEvent(
      new CustomEvent('LMS_TASK_COMPLETED', {
        detail: { taskId: task?.id || task?.taskId },
      })
    );

    if (nextAction) {
      setTimeout(nextAction, 1000);
    }
  }

  function check() {
    const placedCount = Object.keys(placements).length;
    const totalCount = data.cards.length;

    if (placedCount < totalCount) {
      setStatus(`Place all code snippets first. ${placedCount}/${totalCount} placed.`);
      return;
    }

    setStatus('Correct!');
    triggerSuccess();
  }

  const unplacedCards = data.cards.filter((card) => !placements[card.id]);

  return (
    <LmsActivityFrame
      title={data.prompt}
      status={status}
      onPrevTask={prevAction}
      onNextTask={nextAction}
      onCheck={check}
      onReset={reset}
      isTaskDone={isTaskDone}
    >
      <article className="code-classification-task">
        <section className="code-classification-board">
          <div className="classification-header">
            <span>{data.prompt}</span>
          </div>

          <div className="classification-card-grid">
            {unplacedCards.length > 0 ? (
              unplacedCards.map((card) => (
                <div
                  key={card.id}
                  className="classification-card"
                  draggable
                  onDragStart={(event) => handleDragStart(event, card.id)}
                >
                  <CardPreview card={card} />
                </div>
              ))
            ) : (
              <div className="classification-empty">
                All snippets placed.
              </div>
            )}
          </div>

          <div className="classification-categories">
            {data.categories.map((category) => {
              const cards = data.cards.filter((card) => placements[card.id] === category);

              return (
                <div key={category} className="classification-category">
                  <h3>{category}</h3>

                  <div
                    className="classification-drop-zone"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleDrop(event, category)}
                  >
                    {cards.length ? (
                      cards.map((card) => (
                        <button
                          key={card.id}
                          type="button"
                          className="classification-placed-card"
                          draggable
                          onDragStart={(event) => handleDragStart(event, card.id)}
                          onClick={() => unplaceCard(card.id)}
                        >
                          <CardPreview card={card} />
                        </button>
                      ))
                    ) : (
                      <span>Drop code here</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </article>
    </LmsActivityFrame>
  );
}