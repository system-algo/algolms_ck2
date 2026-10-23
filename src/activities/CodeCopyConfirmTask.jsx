import { useEffect, useMemo, useState } from 'react';
import './CodeCopyConfirmTask.css';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import {
  loadLocalTaskState,
  saveLocalTaskState,
  resolveActivityMapUrl,
} from '../lib/taskExtractors.js';

const DEFAULT_CODE = '';

const LUA_KEYWORDS = new Set([
  'local',
  'while',
  'true',
  'false',
  'do',
  'if',
  'then',
  'else',
  'elseif',
  'for',
  'in',
  'repeat',
  'until',
  'return',
  'function',
  'end',
]);

const LUA_FUNCTIONS = new Set([
  'wait',
  'print',
  'pairs',
  'ipairs',
  'tonumber',
  'tostring',
  'require',
]);

const LUA_OBJECTS = new Set([
  'script',
  'game',
  'workspace',
  'math',
  'Vector3',
  'Color3',
  'Instance',
  'Enum',
]);

const LUA_PROPERTIES = new Set([
  'Parent',
  'CFrame',
  'AngularVelocity',
  'fromEulerAnglesXYZ',
  'pi',
]);

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

function getStates(task) {
  return Array.isArray(task?.states) ? task.states : [];
}

function getImageSrc(image) {
  if (typeof image === 'string') return image;

  return (
    image?.localSrc ||
    image?.publicSrc ||
    image?.src ||
    image?.url ||
    image?.href ||
    ''
  );
}

function normalizeImage(image) {
  if (!image) return null;

  if (typeof image === 'string') {
    return {
      src: image,
      alt: '',
      width: 0,
      height: 0,
    };
  }

  const src = getImageSrc(image);

  if (!src) return null;

  return {
    ...image,
    src,
    alt: image.alt || '',
    width: image.naturalWidth || image.width || image.rect?.w || 0,
    height: image.naturalHeight || image.height || image.rect?.h || 0,
  };
}

function getUniqueImages(task) {
  const images = [];

  getStates(task).forEach((state) => {
    (state.images || []).forEach((image) => {
      const normalized = normalizeImage(image);

      if (!normalized?.src) return;

      if (normalized.width < 40 && normalized.height < 40) return;

      images.push(normalized);
    });
  });

  const seen = new Set();

  return images.filter((image) => {
    if (seen.has(image.src)) return false;

    seen.add(image.src);
    return true;
  });
}

function getBestImage(task) {
  const images = getUniqueImages(task);

  if (!images.length) return null;

  return [...images].sort((a, b) => {
    const areaA = Number(a.width || 0) * Number(a.height || 0);
    const areaB = Number(b.width || 0) * Number(b.height || 0);

    return areaB - areaA;
  })[0];
}

function getConfigFromTask(task) {
  return (
    task?.codeCopyConfirm ||
    task?.codeCopy ||
    task?.copyCode ||
    task?.renderer?.codeCopyConfirm ||
    task?.renderer?.codeCopy ||
    null
  );
}

function getCodeFromTask(task) {
  const states = getStates(task);

  for (const state of states) {
    const codeBlock = Array.isArray(state.codeBlocks) ? state.codeBlocks[0] : null;

    if (codeBlock?.text) return codeBlock.text;
    if (codeBlock?.code) return codeBlock.code;
    if (codeBlock?.content) return codeBlock.content;
    if (codeBlock?.value) return codeBlock.value;
  }

  return '';
}

function buildConfig(task, manualConfig) {
  const directConfig = getConfigFromTask(task) || {};
  const config = manualConfig || directConfig || {};

  const title =
    config.title ||
    task?.title ||
    '';

  const question =
    config.question ||
    config.confirmText ||
    'Did you copy the text?';

  const buttonText =
    config.buttonText ||
    config.confirmButtonText ||
    'Yes';

  const code =
    config.code ||
    getCodeFromTask(task) ||
    DEFAULT_CODE;

  const manualImage = normalizeImage(config.image);
  const image = manualImage || getBestImage(task);

  const part = config.part || '';

  return {
    title,
    part,
    question,
    buttonText,
    code,
    image,
  };
}

function getLuaTokenClass(token, nextToken = '') {
  if (/^\s+$/.test(token)) return '';

  if (/^--/.test(token)) {
    return 'comment';
  }

  if (/^(['"]).*\1$/.test(token)) {
    return 'string';
  }

  if (/^\d+(\.\d+)?$/.test(token)) {
    return 'number';
  }

  if (LUA_KEYWORDS.has(token)) {
    return 'keyword';
  }

  if (LUA_FUNCTIONS.has(token) || nextToken === '(') {
    return 'function';
  }

  if (LUA_OBJECTS.has(token)) {
    return 'object';
  }

  if (LUA_PROPERTIES.has(token)) {
    return 'property';
  }

  return '';
}

function tokenizeLuaLine(line) {
  return String(line).match(
    /(--.*$)|("(?:\\.|[^"])*"|'(?:\\.|[^'])*')|(\s+)|([A-Za-z_][A-Za-z0-9_]*)|(\d+(?:\.\d+)?)|([^\sA-Za-z0-9_])/g,
  ) || [];
}

function renderCodeLine(line, lineIndex) {
  const tokens = tokenizeLuaLine(line);

  return (
    <div key={lineIndex} className="code-copy-line">
      {tokens.map((token, index) => {
        const nextToken = tokens[index + 1] || '';
        const className = getLuaTokenClass(token, nextToken);

        if (!className) {
          return <span key={`${lineIndex}-${index}`}>{token}</span>;
        }

        return (
          <span key={`${lineIndex}-${index}`} className={`code-copy-token ${className}`}>
            {token}
          </span>
        );
      })}
    </div>
  );
}

export default function CodeCopyConfirmTask({
  task,
  pageInstance,
  onPrevTask,
  onNextTask,
  isTaskDone,
  completedTaskIds,
}) {
  const taskId = getTaskId(task);
  const [localCompleted, setLocalCompleted] = useState(false);
  const isAlreadyDone =
    localCompleted ||
    isTaskDone ||
    (Array.isArray(completedTaskIds) && (completedTaskIds.includes(task?.id) || completedTaskIds.includes(taskId)));

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
          manualTask?.codeCopyConfirm ||
          manualTask?.codeCopy ||
          manualTask?.copyCode ||
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

  const data = useMemo(
    () => buildConfig(task, manualConfig),
    [task, manualConfig],
  );

  const [answer, setAnswer] = useState(() => {
    const saved = loadLocalTaskState(taskId, null);
    return saved?.answer || '';
  });

  const [status, setStatus] = useState(() => {
    const saved = loadLocalTaskState(taskId, null);
    const s = saved?.status || '';
    if (s === 'Ready to submit') return '';
    if (s === 'Completed') return 'You got it!';
    return s;
  });

  useEffect(() => {
    const saved = loadLocalTaskState(taskId, null);

    setAnswer(saved?.answer || '');
    const s = saved?.status || '';
    if (s === 'Ready to submit') setStatus('');
    else if (s === 'Completed') setStatus('You got it!');
    else setStatus(s);
  }, [taskId]);

  useEffect(() => {
    if (answer || status) {
      saveLocalTaskState(taskId, {
        answer,
        status,
      });
    }
  }, [taskId, answer, status]);

  function handleYesClick() {
    const nextVal = 'Yes';
    setAnswer(nextVal);
    setStatus('');
    saveLocalTaskState(task.id, { answer: nextVal, status: '' });
  }

  function handleCheck() {
    if (!answer && !status) {
      setAnswer('Yes');
    }

    setStatus('You got it!');
    saveLocalTaskState(task.id, { answer: answer || 'Yes', status: 'You got it!' });

    if (!isAlreadyDone) {
      setLocalCompleted(true);
      import('../utils/lmsSounds.js')
        .then(({ playLmsSound, LMS_SOUND_TYPES }) => {
          playLmsSound(LMS_SOUND_TYPES.COMPLETE_ACTIVITY);
        })
        .catch(() => {});

      window.dispatchEvent(
        new CustomEvent('LMS_TASK_COMPLETED', {
          detail: { taskId: task?.id || task?.taskId },
        })
      );

      if (onNextTask) {
        setTimeout(onNextTask, 1000);
      }
    }
  }

  function resetAnswer() {
    setAnswer('');
    setStatus('');
    saveLocalTaskState(task.id, { answer: '', status: '' });
  }

  return (
    <LmsActivityFrame
      title={data.title}
      status={status}
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
      onCheck={handleCheck}
      onReset={resetAnswer}
      isTaskDone={isTaskDone}
    >
      <article className="code-copy-task">
        <div className="code-copy-card">
          {data.title && !/^part\s*\d/i.test(data.title.trim()) ? <h1>{data.title}</h1> : null}

          {data.image?.src && (
            <div className="code-copy-image-wrap">
              <img src={data.image.src} alt={data.image.alt || ''} />
            </div>
          )}

          <div className="code-copy-confirm-row">
            <label>{data.question}</label>
            <button
              type="button"
              className="code-copy-yes-btn"
              draggable={true}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', data.buttonText || 'Yes');
              }}
              onClick={handleYesClick}
              title="Click or drag to input box"
            >
              {data.buttonText}
            </button>
            <input
              type="text"
              className="code-copy-input-box"
              value={answer}
              onChange={(e) => {
                setAnswer(e.target.value);
                setStatus('');
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }}
              onDrop={(e) => {
                e.preventDefault();
                const text = e.dataTransfer.getData('text/plain') || 'Yes';
                setAnswer(text);
                setStatus('');
                saveLocalTaskState(task.id, { answer: text, status: '' });
              }}
            />
          </div>

          {data.code && (
            <pre className="code-copy-code">
              <code>
                {String(data.code)
                  .replace(/\r/g, '')
                  .split('\n')
                  .map(renderCodeLine)}
              </code>
            </pre>
          )}
        </div>
      </article>
    </LmsActivityFrame>
  );
}