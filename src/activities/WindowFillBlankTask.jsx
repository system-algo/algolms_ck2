import { useEffect, useMemo, useState } from 'react';
import './WindowFillBlankTask.css';
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

function normalizeAnswer(value) {
  return normalizeText(value).toLowerCase();
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

function getAllTextLines(task) {
  const lines = [];
  const seen = new Set();

  function collect(value, depth = 0) {
    if (depth > 12 || value == null) return;

    if (typeof value === 'string') {
      String(value)
        .replace(/\r/g, '\n')
        .split('\n')
        .map(normalizeText)
        .filter(Boolean)
        .forEach((line) => {
          const key = line.toLowerCase();

          if (seen.has(key)) return;

          seen.add(key);
          lines.push(line);
        });

      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => collect(item, depth + 1));
      return;
    }

    if (typeof value === 'object') {
      Object.values(value).forEach((item) => collect(item, depth + 1));
    }
  }

  collect(task);

  return lines.filter((line) => {
    const lower = line.toLowerCase();

    if (!line) return false;
    if (lower === 'answer') return false;
    if (lower === 'reset') return false;
    if (lower === 'check') return false;
    if (lower === 'next') return false;
    if (lower === 'show raw capture') return false;
    if (lower === 'static content rendered from capture data.') return false;
    if (/^attempt\s*:?\s*\d+\/\d+$/i.test(line)) return false;

    return true;
  });
}

function getFallbackConfig(task) {
  const lines = getAllTextLines(task);
  const title = task?.title || lines[0] || 'Fill in the blanks';
  const titleLower = normalizeAnswer(title);

  const bodyLines = lines.filter((line) => normalizeAnswer(line) !== titleLower);

  const instruction =
    bodyLines.find((line) => /spelling mistakes|check how/i.test(line)) ||
    '';

  return {
    title,
    instruction,
    paragraphs: [
      {
        parts: [
          'The ',
          {
            blankId: 'blank-1',
            answer: 'Explorer',
          },
          ' window contains many folders, one of which is Workspace. The Workspace folder contains all the parts for a particular world.',
        ],
      },
      {
        parts: [
          'If you click on a part in the editor window, all its properties will open in the ',
          {
            blankId: 'blank-2',
            answer: 'Properties',
          },
          ' window.',
        ],
      },
    ],
  };
}

function getConfigFromTask(task) {
  return task?.windowFillBlank || task?.windowFill || null;
}

function getBlankParts(config) {
  const blanks = [];

  (config?.paragraphs || []).forEach((paragraph) => {
    (paragraph.parts || []).forEach((part) => {
      if (!part || typeof part !== 'object' || !part.blankId) return;

      blanks.push({
        blankId: String(part.blankId),
        answer: part.answer,
        answers: Array.isArray(part.answers) ? part.answers : null,
      });
    });
  });

  return blanks;
}

function getAcceptedAnswers(blank) {
  const answers = Array.isArray(blank.answers)
    ? blank.answers
    : [blank.answer];

  return answers
    .map(normalizeAnswer)
    .filter(Boolean);
}

function isBlankCorrect(blank, value) {
  const answer = normalizeAnswer(value);
  const accepted = getAcceptedAnswers(blank);

  if (!answer || !accepted.length) return false;

  return accepted.includes(answer);
}

function renderParagraphParts(paragraph, values, onChange, results, disabled = false) {
  return (paragraph.parts || []).map((part, index) => {
    if (typeof part === 'string') {
      return (
        <span key={`text-${index}`}>
          {part}
        </span>
      );
    }

    if (!part || typeof part !== 'object' || !part.blankId) {
      return null;
    }

    const blankId = String(part.blankId);
    const result = results[blankId];

    let resultClass = '';

    if (result === true) resultClass = 'is-correct';
    if (result === false) resultClass = 'is-wrong';

    return (
      <input
        key={blankId}
        className={`window-fill-blank-input ${resultClass}`}
        value={values[blankId] || ''}
        onChange={(event) => onChange(blankId, event.target.value)}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
      />
    );
  });
}

export default function WindowFillBlankTask({
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
          manualTask?.windowFillBlank ||
          manualTask?.windowFill ||
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

  const blanks = useMemo(() => getBlankParts(config), [config]);

  const saved = loadLocalTaskState(storageKey, null);

  const [values, setValues] = useState(saved?.values || {});
  const [results, setResults] = useState(saved?.results || {});
  const [status, setStatus] = useState(saved?.status || '');
  const [checking, setChecking] = useState(false);

  const images = useMemo(() => getUniqueImages(task), [task]);
  const image = images[0] || null;

  useEffect(() => {
    const nextSaved = loadLocalTaskState(storageKey, null);

    setValues(nextSaved?.values || {});
    setResults(nextSaved?.results || {});
    setStatus(nextSaved?.status || '');
    setChecking(false);
  }, [storageKey]);

  useEffect(() => {
    saveLocalTaskState(storageKey, {
      values,
      results,
      status,
    });
  }, [storageKey, values, results, status]);

  function updateBlank(blankId, value) {
    setValues((current) => ({
      ...current,
      [blankId]: value,
    }));

    setResults({});
    setStatus('');
  }

  function resetAnswer() {
    if (checking) return;

    setValues({});
    setResults({});
    setStatus('');
  }

  function runLocalCheck() {
    if (!blanks.length) {
      setStatus('No blanks configured for this task.');
      return;
    }

    const nextResults = {};
    let filledCount = 0;

    blanks.forEach((blank) => {
      const value = values[blank.blankId] || '';

      if (normalizeText(value)) {
        filledCount += 1;
      }

      nextResults[blank.blankId] = isBlankCorrect(blank, value);
    });

    setResults(nextResults);

    if (filledCount < blanks.length) {
      setStatus('Please fill in all blanks first.');
      return;
    }

    const allCorrect = Object.values(nextResults).every(Boolean);

    if (allCorrect) {
      setStatus('Correct!');
      triggerSuccess();
    } else {
      setStatus('A mistake has been made! Try again.');
    }
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

  function getAnswerPayload() {
    return {
      values,
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
        activityType: 'window-fill-blank-task',
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

    if (details.blankResults && typeof details.blankResults === 'object') {
      setResults(details.blankResults);
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
      setStatus(result.feedback || 'Please fill in all blanks first.');
      return;
    }

    if (result.feedback || payload?.attempt?.feedback) {
      setStatus(result.feedback || payload.attempt.feedback);
      return;
    }

    setStatus('A mistake has been made! Try again.');
  }

  async function checkAnswer() {
    if (!blanks.length) {
      setStatus('No blanks configured for this task.');
      return;
    }

    const filledCount = blanks.filter((blank) => normalizeText(values[blank.blankId] || '')).length;

    if (filledCount < blanks.length) {
      const nextResults = {};

      blanks.forEach((blank) => {
        nextResults[blank.blankId] = false;
      });

      setResults(nextResults);
      setStatus('Please fill in all blanks first.');
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
      console.error('[WINDOW_FILL_BLANK_SUBMIT_ERROR]', error);
      runLocalCheck();
    } finally {
      setChecking(false);
    }
  }

  return (
    <LmsActivityFrame
      title={config.title}
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
      <article className="window-fill-task">
        <aside className="window-fill-side-card">
          {image ? (
            <img
              className="window-fill-side-image"
              src={image.src}
              alt={image.alt || ''}
              draggable={false}
            />
          ) : null}

          <div className="window-fill-side-content">
            <h1>{config.title}</h1>

            {config.instruction ? (
              <p>{config.instruction}</p>
            ) : null}
          </div>
        </aside>

        <section className="window-fill-main-card">
          {(config.paragraphs || []).map((paragraph, index) => (
            <p key={`paragraph-${index}`} className="window-fill-paragraph">
              {renderParagraphParts(paragraph, values, updateBlank, results, checking)}
            </p>
          ))}
        </section>
      </article>
    </LmsActivityFrame>
  );
}