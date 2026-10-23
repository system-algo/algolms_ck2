import { useEffect, useMemo, useRef, useState } from 'react';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import './TypingPracticeTask.css';

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function getTaskId(task) {
  return String(task?.id || task?.taskId || '').trim();
}

function getStateId(state) {
  return String(state?.id || state?.stateId || '').trim();
}

function collectAllText(value, output = [], depth = 0) {
  if (depth > 12 || value == null) return output;

  if (typeof value === 'string') {
    const text = value.trim();
    if (text) output.push(text);
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectAllText(item, output, depth + 1));
    return output;
  }

  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectAllText(item, output, depth + 1));
  }

  return output;
}

function isNoiseLine(line) {
  const text = normalizeText(line).toLowerCase();

  if (!text) return true;
  if (text === 'next') return true;
  if (text === 'reset') return true;
  if (text === 'check') return true;
  if (text === 'run') return true;
  if (text === "let's go!") return true;
  if (text === "let's go") return true;
  if (text.includes('screenshots/')) return true;
  if (text.includes('assets/')) return true;
  if (text.includes('queryselector')) return true;
  if (text.includes('nth-of-type')) return true;
  if (text.includes('dom path')) return true;
  if (text.includes('css selector')) return true;

  return false;
}

function inferLinesFromSource(task, state) {
  const source = state || task;
  const seen = new Set();

  return collectAllText(source)
    .flatMap((text) => String(text).replace(/\r/g, '\n').split('\n'))
    .map(normalizeText)
    .filter((line) => !isNoiseLine(line))
    .filter((line) => {
      const key = line.toLowerCase();

      if (seen.has(key)) return false;

      seen.add(key);
      return true;
    });
}

function getTypingConfig(pageInstance, task, state) {
  const taskId = getTaskId(task);
  const stateId = getStateId(state);

  const taskRenderer = taskId ? pageInstance?.taskRenderers?.[taskId] : null;
  const stateRenderer = taskRenderer && stateId ? taskRenderer.states?.[stateId] : null;

  return (
    stateRenderer?.typingPractice ||
    taskRenderer?.typingPractice ||
    state?.typingPractice ||
    task?.typingPractice ||
    null
  );
}

function buildData(config, task, state) {
  const fallbackLines = inferLinesFromSource(task, state);

  const mode = String(config?.mode || '').trim().toLowerCase();

  const inferredIntro =
    fallbackLines.some((line) => line.toLowerCase().includes('type the text')) ||
    fallbackLines.some((line) => line.toLowerCase().includes('typing speed'));

  if (mode === 'intro' || inferredIntro) {
    return {
      mode: 'intro',
      title: normalizeText(
        config?.title ||
          fallbackLines.find((line) => line.toLowerCase().includes('type the text')) ||
          'Type the text – the faster, the better',
      ),
      description: normalizeText(
        config?.description ||
          fallbackLines.find((line) => line.toLowerCase().includes('typing speed')) ||
          'For a programmer, typing speed is very important.',
      ),
      buttonText: normalizeText(config?.buttonText || "LET'S GO!"),
    };
  }

  const configLines = Array.isArray(config?.lines)
    ? config.lines.map(normalizeText).filter(Boolean)
    : [];

  const lines = configLines.length > 0
    ? configLines
    : fallbackLines.filter((line) => {
        const lower = line.toLowerCase();

        if (lower.includes('type the text')) return false;
        if (lower.includes('typing speed')) return false;

        return true;
      });

  return {
    mode: 'typing',
    title: normalizeText(config?.title || ''),
    lines,
    showLineNumbers: config?.showLineNumbers !== false,
    autoNextOnComplete: Boolean(config?.autoNextOnComplete),
  };
}

function splitTarget(lines) {
  return lines.join('\n');
}

function getLineStartIndexes(lines) {
  const starts = [];
  let cursor = 0;

  lines.forEach((line, index) => {
    starts.push(cursor);
    cursor += line.length;

    if (index < lines.length - 1) {
      cursor += 1;
    }
  });

  return starts;
}

function getCurrentUserKey() {
  try {
    const email =
      sessionStorage.getItem('lms_student_email') ||
      localStorage.getItem('lms_student_email') ||
      '';
    const normalized = String(email).trim().toLowerCase();
    return normalized ? `u:${normalized}` : 'anon';
  } catch {
    return 'anon';
  }
}

function getStorageKey(task, state) {
  const userKey = getCurrentUserKey();
  return `typing-practice:v2:${userKey}:${getTaskId(task)}:${getStateId(state) || 'default'}`;
}

function readSavedState(task, state) {
  try {
    const raw = localStorage.getItem(getStorageKey(task, state));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveState(task, state, data) {
  try {
    localStorage.setItem(getStorageKey(task, state), JSON.stringify(data));
  } catch {
    // Ignore storage errors.
  }
}

export default function TypingPracticeTask(props) {
  const {
    task,
    state,
    pageInstance,
    onNextTask,
    onPrevTask,
    onNextState,
  } = props;

  const storageKey = useMemo(() => getStorageKey(task, state), [task, state]);

  const config = useMemo(
    () => getTypingConfig(pageInstance, task, state),
    [pageInstance, task, state],
  );

  const data = useMemo(
    () => buildData(config, task, state),
    [config, task, state],
  );

  const [typed, setTyped] = useState(() => {
    const saved = readSavedState(task, state);
    return saved?.typed || '';
  });
  const [wrongText, setWrongText] = useState('');
  const [startedAt, setStartedAt] = useState(() => {
    const saved = readSavedState(task, state);
    return saved?.startedAt || null;
  });
  const [finishedAt, setFinishedAt] = useState(() => {
    const saved = readSavedState(task, state);
    return saved?.finishedAt || null;
  });

  const focusRef = useRef(null);
  const wrongTimerRef = useRef(null);
  const autoNextTimerRef = useRef(null);

  const targetText = useMemo(() => {
    if (data.mode !== 'typing') return '';
    return splitTarget(data.lines);
  }, [data]);

  const lineStarts = useMemo(() => {
    if (data.mode !== 'typing') return [];
    return getLineStartIndexes(data.lines);
  }, [data]);

  const complete = data.mode === 'typing' && targetText.length > 0 && typed.length >= targetText.length;

  useEffect(() => {
    const saved = readSavedState(task, state);
    setTyped(saved?.typed || '');
    setWrongText('');
    setStartedAt(saved?.startedAt || null);
    setFinishedAt(saved?.finishedAt || null);
  }, [storageKey, task, state]);

  useEffect(() => {
    if (data.mode !== 'typing') return;

    saveState(task, state, {
      typed,
      startedAt,
      finishedAt,
    });
  }, [data.mode, task, state, typed, startedAt, finishedAt]);

  useEffect(() => {
    if (data.mode !== 'typing') return;

    const timer = window.setTimeout(() => {
      focusRef.current?.focus();
    }, 100);

    return () => window.clearTimeout(timer);
  }, [data.mode, storageKey]);

  useEffect(() => {
    if (!complete || finishedAt) return;

    setFinishedAt(Date.now());
    window.dispatchEvent(
      new CustomEvent('LMS_TASK_COMPLETED', {
        detail: { taskId: task?.id || task?.taskId },
      })
    );
  }, [complete, finishedAt, task]);

  useEffect(() => {
    if (!complete || !data.autoNextOnComplete || !onNextTask) return;

    autoNextTimerRef.current = window.setTimeout(() => {
      onNextTask();
    }, 700);

    return () => {
      if (autoNextTimerRef.current) {
        window.clearTimeout(autoNextTimerRef.current);
      }
    };
  }, [complete, data.autoNextOnComplete, onNextTask]);

  function handleStart() {
    setStartedAt((current) => current || Date.now());

    /*
      Quan trọng:
      LET'S GO! chỉ chuyển sang state tiếp theo trong cùng task.
      Không được gọi onNextTask(), vì như vậy sẽ nhảy sang activity khác.
    */
    if (typeof onNextState === 'function') {
      onNextState();
    }
  }

  function showWrongChar(char) {
    setWrongText((current) => `${current}${char}`);

    if (wrongTimerRef.current) {
      window.clearTimeout(wrongTimerRef.current);
    }

    wrongTimerRef.current = window.setTimeout(() => {
      setWrongText('');
    }, 420);
  }

  function handleKeyDown(event) {
    if (data.mode !== 'typing') return;

    const key = event.key;

    if (key === 'Tab') {
      event.preventDefault();
      return;
    }

    if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta' || key === 'CapsLock') {
      return;
    }

    if (key === 'Backspace') {
      event.preventDefault();

      if (complete) return;

      setTyped((current) => current.slice(0, -1));
      setWrongText('');
      return;
    }

    if (key === 'Enter') {
      event.preventDefault();

      const expected = targetText[typed.length];

      if (expected === '\n') {
        if (!startedAt) setStartedAt(Date.now());

        setTyped((current) => `${current}\n`);
        setWrongText('');
      } else {
        showWrongChar('↵');
      }

      return;
    }

    if (key.length !== 1) return;

    event.preventDefault();

    if (complete) return;

    const expected = targetText[typed.length];

    if (!startedAt) setStartedAt(Date.now());

    if (key === expected) {
      setTyped((current) => `${current}${key}`);
      setWrongText('');
      return;
    }

    showWrongChar(key);
  }

  function resetTyping() {
    setTyped('');
    setWrongText('');
    setStartedAt(null);
    setFinishedAt(null);
    focusRef.current?.focus();
  }

  function renderLine(line, lineIndex) {
    const start = lineStarts[lineIndex];

    return (
      <div className="typing-practice-line" key={`${lineIndex}-${line}`}>
        {data.showLineNumbers ? (
          <span className="typing-practice-line-number">
            {lineIndex + 1}
          </span>
        ) : null}

        <span className="typing-practice-line-content">
          {line.split('').map((char, charIndex) => {
            const absoluteIndex = start + charIndex;
            const isDone = absoluteIndex < typed.length;
            const isCurrent = absoluteIndex === typed.length && !complete;

            let className = 'typing-practice-char';

            if (isDone) className += ' is-done';
            if (isCurrent) className += ' is-current';

            return (
              <span className={className} key={`${lineIndex}-${charIndex}`}>
                {isCurrent && wrongText ? (
                  <span className="typing-practice-wrong">
                    {wrongText}
                  </span>
                ) : null}
                {char === ' ' ? '\u00a0' : char}
              </span>
            );
          })}

          {line.length === 0 && typed.length === start && wrongText ? (
            <span className="typing-practice-wrong">{wrongText}</span>
          ) : null}
        </span>
      </div>
    );
  }

  if (data.mode === 'intro') {
    return (
      <LmsActivityFrame
        title={data.title}
        status=""
        onPrevTask={onPrevTask}
        onNextTask={onNextTask}
      >
        <article className="typing-practice typing-practice-intro-screen">
          <section className="typing-practice-intro-card">
            <h1>{data.title}</h1>
            <p>{data.description}</p>

            <button
              type="button"
              className="typing-practice-start-button"
              onClick={handleStart}
            >
              {data.buttonText}
            </button>
          </section>
        </article>
      </LmsActivityFrame>
    );
  }

  return (
    <LmsActivityFrame
      title={data.title || 'Typing practice'}
      status=""
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
    >
      <article
        className="typing-practice typing-practice-screen"
        tabIndex={0}
        ref={focusRef}
        onKeyDown={handleKeyDown}
        onClick={() => focusRef.current?.focus()}
      >
        <section className="typing-practice-editor">
          {data.lines.length > 0 ? (
            data.lines.map(renderLine)
          ) : (
            <div className="typing-practice-empty">
              No typing text configured for this task.
            </div>
          )}
        </section>

        <footer className="typing-practice-footer">
          <div className="typing-practice-progress">
            {typed.length}
            /
            {targetText.length}
          </div>

          {complete ? (
            <div className="typing-practice-complete">
              Completed
            </div>
          ) : (
            <div className="typing-practice-hint">
              Type exactly as shown. Wrong keys will flash.
            </div>
          )}

          <button
            type="button"
            className="typing-practice-reset"
            onClick={resetTyping}
          >
            Reset
          </button>
        </footer>
      </article>
    </LmsActivityFrame>
  );
}