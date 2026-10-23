import { useEffect, useMemo, useState } from 'react';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import {
  loadLocalTaskState,
  saveLocalTaskState,
} from '../lib/taskExtractors.js';

function normalizeText(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function unique(values) {
  const seen = new Set();
  const result = [];

  values.forEach((value) => {
    const text = normalizeText(value);
    if (!text) return;

    const key = text.replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    result.push(text);
  });

  return result;
}

function isNoiseLine(line) {
  const text = normalizeText(line);
  const lower = text.toLowerCase();

  if (!text) return true;
  if (lower === 'part 1.') return true;
  if (lower === 'attempt') return true;
  if (/^:?\s*\d+\/\d+$/.test(lower)) return true;
  if (/^attempt\s*:?\s*\d+\/\d+$/.test(lower)) return true;
  if (lower === 'tasks with automatic check') return true;
  if (lower === 'my solution') return true;
  if (lower === 'next') return true;
  if (lower === 'show raw capture') return true;
  if (lower === 'use activity renderer') return true;
  if (lower.includes('screenshots/')) return true;
  if (lower.includes('assets/')) return true;
  if (lower.includes('generated/')) return true;
  if (lower.includes('task-preview')) return true;

  return false;
}

function looksLikeCategory(line) {
  const text = normalizeText(line).toLowerCase();

  return (
    text.startsWith('the program') ||
    text.startsWith('the interpreter') ||
    text.includes('prints the string') ||
    text.includes('prints a number') ||
    text.includes('displays an error')
  );
}

function isCodeCategoryPromptLine(line) {
  const text = normalizeText(line);

  return (
    /match.*code.*snippet.*categor/i.test(text) ||
    /match.*code.*categor/i.test(text)
  );
}

function isPairPromptLine(line) {
  const text = normalizeText(line);

  return (
    /match.*expressions?.*values?/i.test(text) ||
    /match.*expression/i.test(text) ||
    /connect.*expressions?.*values?/i.test(text)
  );
}

function isPromptLine(line) {
  return isCodeCategoryPromptLine(line) || isPairPromptLine(line);
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n\s+\n/g, '\n');
}

function splitCandidateText(value) {
  return stripHtml(value)
    .replace(/\r/g, '\n')
    .split('\n')
    .map(normalizeText)
    .filter(Boolean);
}

function collectAllStrings(value, output = [], depth = 0) {
  if (depth > 20) return output;
  if (value == null) return output;

  if (typeof value === 'string') {
    const text = value.trim();
    if (text) output.push(text);
    return output;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
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

function collectTextLines(state) {
  const fromTextLines = [];

  if (Array.isArray(state?.textLines)) {
    state.textLines.forEach((line) => {
      const text = normalizeText(line);
      if (!isNoiseLine(text)) fromTextLines.push(text);
    });
  }

  const fromAllRawStrings = collectAllStrings(state)
    .flatMap(splitCandidateText)
    .map(normalizeText)
    .filter((line) => !isNoiseLine(line));

  return unique([...fromTextLines, ...fromAllRawStrings]);
}

function looksLikeExpressionLine(line) {
  const text = normalizeText(line);
  const lower = text.toLowerCase();

  if (!text) return false;
  if (isNoiseLine(text)) return false;
  if (isPromptLine(text)) return false;
  if (text.length > 80) return false;

  return (
    /^[a-zA-Z_][\w.]*\s*\(.*\)$/.test(text) ||
    /^from\s+\S+\s+import\s+.+$/.test(text) ||
    /^import\s+.+$/.test(text) ||
    /^[a-zA-Z_][\w.]*\s*\[\s*.+\s*\]$/.test(text) ||
    /^[a-zA-Z_][\w.]*\s*[+\-*/%]\s*.+$/.test(text) ||
    lower.includes('randint') ||
    lower.includes('sleep') ||
    lower.includes('time()')
  );
}

function looksLikePairValueLine(line) {
  const text = normalizeText(line);
  const lower = text.toLowerCase();

  if (!text) return false;
  if (isNoiseLine(text)) return false;
  if (isPromptLine(text)) return false;
  if (looksLikeExpressionLine(text)) return false;
  if (looksLikeCategory(text)) return false;

  return (
    text.length >= 8 ||
    lower.includes('return') ||
    lower.includes('pause') ||
    lower.includes('connect') ||
    lower.includes('generate') ||
    lower.includes('error')
  );
}

function getExplicitPairItems(source) {
  const possibleArrays = [
    source?.pairs,
    source?.matchingPairs,
    source?.matches,
    source?.items,
  ].filter(Array.isArray);

  for (const array of possibleArrays) {
    const pairs = array
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null;

        const left =
          item.left ||
          item.expression ||
          item.term ||
          item.question ||
          item.source ||
          item.prompt ||
          item.key ||
          '';

        const right =
          item.right ||
          item.value ||
          item.meaning ||
          item.definition ||
          item.answer ||
          item.target ||
          item.label ||
          '';

        if (!left || !right) return null;

        return {
          left: {
            id: `left-${index + 1}`,
            text: normalizeText(left),
          },
          right: {
            id: `right-${index + 1}`,
            text: normalizeText(right),
          },
        };
      })
      .filter(Boolean);

    if (pairs.length >= 2) {
      return {
        leftItems: pairs.map((pair) => pair.left),
        rightItems: pairs.map((pair) => pair.right),
      };
    }
  }

  return null;
}

function getPairMatchingData(task, state, lines, prompt) {
  const source = state || task;

  const explicit = getExplicitPairItems(source) || getExplicitPairItems(task);

  if (explicit) {
    return {
      prompt,
      leftItems: explicit.leftItems,
      rightItems: explicit.rightItems,
    };
  }

  const expressions = unique(lines.filter(looksLikeExpressionLine));
  const values = unique(lines.filter(looksLikePairValueLine));

  const maxCount = Math.min(
    12,
    expressions.length,
    values.length || expressions.length,
  );

  return {
    prompt,
    leftItems: expressions.slice(0, maxCount).map((text, index) => ({
      id: `left-${index + 1}`,
      text,
    })),
    rightItems: values.slice(0, maxCount).map((text, index) => ({
      id: `right-${index + 1}`,
      text,
    })),
  };
}

function getCodeTypingData(task, state) {
  const source = state || task;
  const lines = collectTextLines(source);

  const prompt =
    source.codeTypingPrompt ||
    task.codeTypingPrompt ||
    lines.find(isPromptLine) ||
    task.title ||
    'Match the code snippets to the categories.';

  const categoriesFromState = Array.isArray(source.codeTypingCategories)
    ? source.codeTypingCategories.filter(Boolean)
    : [];

  const categoriesFromTask = Array.isArray(task.codeTypingCategories)
    ? task.codeTypingCategories.filter(Boolean)
    : [];

  const categoriesFromLines = unique(lines.filter(looksLikeCategory));

  const snippetsFromState = Array.isArray(source.snippets)
    ? source.snippets.filter((item) => item?.code || item?.image)
    : [];

  const snippetsFromTask = Array.isArray(task.snippets)
    ? task.snippets.filter((item) => item?.code || item?.image)
    : [];

  const fallbackImages = Array.isArray(source.snippetImages)
    ? source.snippetImages.filter((item) => item?.image).map((item, index) => ({
      id: item.id || `snippet-${index + 1}`,
      type: 'image',
      image: item.image,
      crop: item.crop || null,
    }))
    : [];

  const snippets = snippetsFromState.length
    ? snippetsFromState
    : snippetsFromTask.length
      ? snippetsFromTask
      : fallbackImages;

  const pairData = getPairMatchingData(task, state, lines, prompt);
  const shouldUsePairMatching =
    isPairPromptLine(prompt) ||
    (
      snippets.length === 0 &&
      pairData.leftItems.length >= 2 &&
      pairData.rightItems.length >= 2
    );

  if (shouldUsePairMatching) {
    return {
      mode: 'pair-matching',
      prompt,
      pairData,
    };
  }

  return {
    mode: 'snippet-category',
    prompt,
    categories: categoriesFromState.length
      ? categoriesFromState
      : categoriesFromTask.length
        ? categoriesFromTask
        : categoriesFromLines.length
          ? categoriesFromLines
          : [
            'The program prints the string',
            'The program prints a number',
            'The interpreter displays an error',
          ],
    snippets,
    snippetSource: source.snippetSource || task.snippetSource || 'unknown',
  };
}

function makeCategoryId(index) {
  return `category-${index + 1}`;
}

function SnippetPreview({ snippet }) {
  if (snippet.type === 'image' || snippet.image) {
    return (
      <div className="snippet-image-wrapper">
        <img
          src={snippet.image}
          alt={snippet.id}
          draggable="false"
        />
      </div>
    );
  }

  return (
    <pre className="snippet-code-text">
      {snippet.code}
    </pre>
  );
}

function PairMatchingRenderer({
  data,
  assignments,
  selectedLeftId,
  selectedRightId,
  setAssignments,
  setSelectedLeftId,
  setSelectedRightId,
  setStatus,
}) {
  const leftItems = data.pairData.leftItems;
  const rightItems = data.pairData.rightItems;

  function getRightById(rightId) {
    return rightItems.find((item) => item.id === rightId);
  }

  function getLeftAssignedToRight(rightId) {
    return Object.entries(assignments).find(([, currentRightId]) => currentRightId === rightId)?.[0] || '';
  }

  function assignPair(leftId, rightId) {
    if (!leftId || !rightId) return;

    setAssignments((current) => {
      const next = { ...current };

      Object.entries(next).forEach(([currentLeftId, currentRightId]) => {
        if (currentRightId === rightId && currentLeftId !== leftId) {
          delete next[currentLeftId];
        }
      });

      next[leftId] = rightId;
      return next;
    });

    setSelectedLeftId('');
    setSelectedRightId('');
    setStatus('');
  }

  function removePair(leftId) {
    setAssignments((current) => {
      const next = { ...current };
      delete next[leftId];
      return next;
    });

    setStatus('');
  }

  function handleLeftClick(leftId) {
    if (selectedRightId) {
      assignPair(leftId, selectedRightId);
      return;
    }

    setSelectedLeftId((current) => (current === leftId ? '' : leftId));
    setStatus('');
  }

  function handleRightClick(rightId) {
    if (selectedLeftId) {
      assignPair(selectedLeftId, rightId);
      return;
    }

    setSelectedRightId((current) => (current === rightId ? '' : rightId));
    setStatus('');
  }

  return (
    <section className="expression-matching-layout">
      <div className="expression-column">
        {leftItems.map((leftItem) => {
          const assignedRight = getRightById(assignments[leftItem.id]);

          return (
            <div
              key={leftItem.id}
              className={`expression-row ${selectedLeftId === leftItem.id ? 'selected' : ''} ${assignedRight ? 'matched' : ''}`}
            >
              <button
                type="button"
                className="expression-pill"
                onClick={() => handleLeftClick(leftItem.id)}
              >
                {leftItem.text}
              </button>

              <button
                type="button"
                className="expression-radio"
                onClick={() => handleLeftClick(leftItem.id)}
                aria-label={`Select ${leftItem.text}`}
              >
                {assignedRight ? '✓' : ''}
              </button>

              <div className="expression-assigned-value">
                {assignedRight ? (
                  <>
                    <span>{assignedRight.text}</span>
                    <button
                      type="button"
                      className="expression-remove"
                      onClick={() => removePair(leftItem.id)}
                      aria-label="Remove match"
                    >
                      ×
                    </button>
                  </>
                ) : (
                  <span className="expression-placeholder">Select a value</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="value-column">
        {rightItems.map((rightItem) => {
          const assignedLeftId = getLeftAssignedToRight(rightItem.id);
          const isAssigned = Boolean(assignedLeftId);

          return (
            <button
              key={rightItem.id}
              type="button"
              className={`value-pill ${selectedRightId === rightItem.id ? 'selected' : ''} ${isAssigned ? 'assigned' : ''}`}
              onClick={() => handleRightClick(rightItem.id)}
            >
              {rightItem.text}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SnippetCategoryRenderer({
  data,
  assignments,
  selectedSnippetId,
  setAssignments,
  setSelectedSnippetId,
  setStatus,
}) {
  const snippetItems = data.snippets;

  const categoryItems = data.categories.map((label, index) => ({
    id: makeCategoryId(index),
    label,
  }));

  const assignedSnippetIds = new Set(
    Object.values(assignments)
      .flat()
      .filter(Boolean),
  );

  const availableSnippets = snippetItems.filter((snippet) => !assignedSnippetIds.has(snippet.id));

  function assignSnippet(categoryId, snippetId) {
    if (!snippetId) return;

    setAssignments((current) => {
      const next = {};

      Object.entries(current).forEach(([currentCategoryId, snippetIds]) => {
        next[currentCategoryId] = Array.isArray(snippetIds)
          ? snippetIds.filter((id) => id !== snippetId)
          : [];
      });

      next[categoryId] = [...(next[categoryId] || []), snippetId];

      return next;
    });

    setSelectedSnippetId('');
    setStatus('');
  }

  function removeSnippet(categoryId, snippetId) {
    setAssignments((current) => ({
      ...current,
      [categoryId]: (current[categoryId] || []).filter((id) => id !== snippetId),
    }));
    setStatus('');
  }

  function handleDragStart(event, snippetId) {
    event.dataTransfer.setData('text/plain', snippetId);
  }

  function handleDrop(event, categoryId) {
    event.preventDefault();
    const snippetId = event.dataTransfer.getData('text/plain');
    assignSnippet(categoryId, snippetId);
  }

  function findSnippet(snippetId) {
    return snippetItems.find((snippet) => snippet.id === snippetId);
  }

  if (snippetItems.length === 0) {
    return (
      <div className="code-data-warning">
        No code snippets, snippet images, or expression matching data were found for this state.
      </div>
    );
  }

  return (
    <>
      <section className="snippet-grid">
        {availableSnippets.map((snippet) => (
          <button
            key={snippet.id}
            type="button"
            draggable
            className={`code-snippet-card ${snippet.type === 'image' ? 'image-snippet-card' : ''} ${selectedSnippetId === snippet.id ? 'selected' : ''}`}
            onClick={() => setSelectedSnippetId(snippet.id)}
            onDragStart={(event) => handleDragStart(event, snippet.id)}
          >
            <SnippetPreview snippet={snippet} />
          </button>
        ))}
      </section>

      <div className="code-task-divider" />

      <section className="category-grid">
        {categoryItems.map((category) => {
          const assignedIds = assignments[category.id] || [];

          return (
            <div key={category.id} className="category-column">
              <h2>{category.label}</h2>

              <div
                className="category-dropzone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleDrop(event, category.id)}
                onClick={() => selectedSnippetId && assignSnippet(category.id, selectedSnippetId)}
              >
                {assignedIds.length === 0 ? (
                  <span className="drop-placeholder">Drop code here</span>
                ) : (
                  assignedIds.map((snippetId) => {
                    const snippet = findSnippet(snippetId);
                    if (!snippet) return null;

                    return (
                      <div
                        key={snippetId}
                        className={`placed-snippet ${snippet.type === 'image' ? 'image-placed-snippet' : ''}`}
                      >
                        <SnippetPreview snippet={snippet} />
                        <button
                          type="button"
                          className="remove-match"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeSnippet(category.id, snippetId);
                          }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}

export default function CodeTypingTask({
  task,
  state,
  onPrevTask,
  onNextTask,
  onPrevState,
  onNextState,
  isTaskDone,
}) {
  const data = useMemo(() => getCodeTypingData(task, state), [task, state]);

  const nextAction = onNextState || onNextTask;
  const prevAction = onPrevState || onPrevTask;

  const taskId = String(task?.id || task?.taskId || 'typing').trim();
  const storageKey = `${taskId}:${state?.id || 'task'}:${data.mode}:v5`;
  const saved = loadLocalTaskState(storageKey, null);

  const [assignments, setAssignments] = useState(saved?.assignments || {});
  const [selectedSnippetId, setSelectedSnippetId] = useState('');
  const [selectedLeftId, setSelectedLeftId] = useState('');
  const [selectedRightId, setSelectedRightId] = useState('');
  const [status, setStatus] = useState(saved?.status || '');

  useEffect(() => {
    setAssignments(saved?.assignments || {});
    setSelectedSnippetId('');
    setSelectedLeftId('');
    setSelectedRightId('');
    setStatus(saved?.status || '');
  }, [storageKey]);

  useEffect(() => {
    saveLocalTaskState(storageKey, { assignments, status });
  }, [storageKey, assignments, status]);

  function reset() {
    setAssignments({});
    setSelectedSnippetId('');
    setSelectedLeftId('');
    setSelectedRightId('');
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

  function check() {
    if (data.mode === 'pair-matching') {
      const total = data.pairData.leftItems.length;
      const completed = data.pairData.leftItems.filter((item) => assignments[item.id]).length;

      if (completed < total) {
        setStatus(`Match all expressions first. ${completed}/${total} matched.`);
        return;
      }

      setStatus('Completed locally.');
      triggerSuccess();
      return;
    }

    const snippetItems = data.snippets;
    const totalAssigned = Object.values(assignments).flat().length;

    if (totalAssigned < snippetItems.length) {
      setStatus(`Place all code snippets first. ${totalAssigned}/${snippetItems.length} placed.`);
      return;
    }

    setStatus('Completed locally.');
    triggerSuccess();
  }

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
      <article className={`code-typing-task ${data.mode === 'pair-matching' ? 'expression-matching-task' : ''}`}>
        <div className="code-task-main">
          <div className="code-task-header">
            <div>
              <h1>{data.prompt}</h1>
            </div>
          </div>

          {data.mode === 'pair-matching' ? (
            <PairMatchingRenderer
              data={data}
              assignments={assignments}
              selectedLeftId={selectedLeftId}
              selectedRightId={selectedRightId}
              setAssignments={setAssignments}
              setSelectedLeftId={setSelectedLeftId}
              setSelectedRightId={setSelectedRightId}
              setStatus={setStatus}
            />
          ) : (
            <SnippetCategoryRenderer
              data={data}
              assignments={assignments}
              selectedSnippetId={selectedSnippetId}
              setAssignments={setAssignments}
              setSelectedSnippetId={setSelectedSnippetId}
              setStatus={setStatus}
            />
          )}
        </div>
      </article>
    </LmsActivityFrame>
  );
}