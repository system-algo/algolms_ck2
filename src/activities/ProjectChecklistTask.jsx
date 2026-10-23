import { useEffect, useMemo, useState } from 'react';
import './ProjectChecklistTask.css';
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
    const existing = localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;

    const next = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    localStorage.setItem(SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function getManualMapUrl(pageInstance) {
  return resolveActivityMapUrl(pageInstance?.manualActivityMap);
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
  const lower = normalizeText(line).toLowerCase();

  if (!lower) return true;
  if (lower === 'answer') return true;
  if (lower === 'reset') return true;
  if (lower === 'check') return true;
  if (lower === 'next') return true;
  if (lower === 'show raw capture') return true;
  if (lower === 'static content rendered from capture data.') return true;
  if (/^attempt\s*:?\s*\d+\/\d+$/i.test(lower)) return true;

  return false;
}

function getFallbackConfig(task) {
  const rawLines = uniqueLines(collectTextLines(task)).filter((line) => !isNoiseLine(line));

  const title =
    task?.title ||
    rawLines.find((line) => line.length < 80) ||
    'Project task';

  const taskLines = rawLines.filter((line) => {
    const lower = line.toLowerCase();

    if (lower === title.toLowerCase()) return false;
    if (/^tasks will be checked/i.test(line)) return false;

    return true;
  });

  const numbered = taskLines
    .map((line) => line.replace(/^\d+\.\s*/, '').trim())
    .filter((line) => line.length > 5);

  return {
    title,
    instructions: numbered.length ? numbered : taskLines,
    checklistTitle: 'TASKS WILL BE CHECKED BY THE TEACHER',
    checklist: numbered.length ? numbered : taskLines,
    inputPlaceholder: '',
  };
}

function getConfigFromTask(task) {
  return task?.projectChecklist || task?.projectTask || null;
}

function getChecklistItems(config) {
  const rawItems = Array.isArray(config?.checklist)
    ? config.checklist
    : Array.isArray(config?.tasks)
      ? config.tasks
      : [];

  return rawItems.map((item, index) => {
    if (typeof item === 'string') {
      return {
        id: `check-${index + 1}`,
        text: item,
      };
    }

    return {
      id: String(item?.id || `check-${index + 1}`),
      text: normalizeText(item?.text || item?.title || item?.label || ''),
    };
  }).filter((item) => item.text);
}

function getInstructionItems(config) {
  const rawItems = Array.isArray(config?.instructions)
    ? config.instructions
    : [];

  return rawItems.map((item) => {
    if (typeof item === 'string') return normalizeText(item);
    return normalizeText(item?.text || item?.title || item?.label || '');
  }).filter(Boolean);
}

export default function ProjectChecklistTask({
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
          manualTask?.projectChecklist ||
          manualTask?.projectTask ||
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

  const storageKey = task.id || taskId || 'project-checklist-default';
  const saved = useMemo(() => loadLocalTaskState(storageKey, null), [storageKey]);

  const [panelOpen, setPanelOpen] = useState(saved?.panelOpen ?? true);
  const [checked, setChecked] = useState(saved?.checked || {});
  const [submission, setSubmission] = useState(saved?.submission || '');

  useEffect(() => {
    const savedState = loadLocalTaskState(storageKey, null);
    setPanelOpen(savedState?.panelOpen ?? true);
    setChecked(savedState?.checked || {});
    setSubmission(savedState?.submission || '');
  }, [storageKey]);

  const images = useMemo(() => getUniqueImages(task), [task]);
  const image = images[0] || null;

  const instructions = getInstructionItems(config);
  const checklist = getChecklistItems(config);

  const [status, setStatus] = useState('');
  const [isCheckLoading, setIsCheckLoading] = useState(false);

  useEffect(() => {
    saveLocalTaskState(storageKey, {
      panelOpen,
      checked,
      submission,
    });
  }, [storageKey, panelOpen, checked, submission]);

  function toggleChecked(itemId) {
    setChecked((current) => ({
      ...current,
      [itemId]: !current[itemId],
    }));
  }

  async function handleCheck() {
    if (!submission || !submission.trim()) {
      setStatus('Please enter a link first.');
      return;
    }

    setIsCheckLoading(true);
    const currentState = { panelOpen, checked, submission };
    saveLocalTaskState(storageKey, currentState);

    try {
      if (API_BASE_URL) {
        const { courseId, lessonId, pageId } = getRuntimeIds(pageInstance);
        if (courseId && lessonId && pageId && taskId) {
          await fetch(`${API_BASE_URL}/api/activity-attempts`, {
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
              activityType: 'project-checklist-task',
              answer: currentState,
              isCorrect: true,
              score: 1,
              maxScore: 1,
            }),
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[ProjectChecklistTask] Error submitting attempt:', e);
    } finally {
      setIsCheckLoading(false);
    }

    if (!isAlreadyDone) {
      setLocalCompleted(true);
      import('../utils/lmsSounds.js').then(({ playLmsSound, LMS_SOUND_TYPES }) => {
        playLmsSound(LMS_SOUND_TYPES.COMPLETE_ACTIVITY);
      }).catch(() => {});

      window.dispatchEvent(
        new CustomEvent('LMS_TASK_COMPLETED', {
          detail: { taskId: task?.id || taskId },
        })
      );
    }

    setStatus('Saved.');

    if (!isAlreadyDone && onNextTask) {
      setTimeout(onNextTask, 600);
    }
  }

  function handleReset() {
    setChecked({});
    setSubmission('');
    saveLocalTaskState(storageKey, { panelOpen, checked: {}, submission: '' });
    setStatus('');
  }

  return (
    <LmsActivityFrame
      title={config.title}
      status={status}
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
      onCheck={handleCheck}
      onReset={handleReset}
      isCheckLoading={isCheckLoading}
      footer={null}
      isTaskDone={isTaskDone}
    >
      <article className={`project-checklist-task ${panelOpen ? 'is-panel-open' : 'is-panel-closed'}`}>
        <section className="project-checklist-main">
          <div className="project-checklist-card">
            {instructions.length > 0 ? (
              <ol className="project-checklist-instructions">
                {instructions.map((instruction, index) => (
                  <li key={`${instruction}-${index}`}>
                    {instruction}
                  </li>
                ))}
              </ol>
            ) : (
              <h1>{config.title}</h1>
            )}

            {image ? (
              <div className="project-checklist-media">
                <img
                  src={image.src}
                  alt={image.alt || ''}
                  draggable={false}
                />
              </div>
            ) : null}

            <div className="project-checklist-submit-row">
              <input
                value={submission}
                onChange={(event) => {
                  setSubmission(event.target.value);
                  if (status && !status.includes('Saved')) {
                    setStatus('');
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleCheck();
                  }
                }}
                placeholder={config.inputPlaceholder || 'Write your answer here, add a file or link...'}
                aria-label="Submission link"
              />

              <button
                type="button"
                className="project-checklist-btn-send"
                onClick={handleCheck}
                aria-label="Send"
                title="Send link"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </div>
          </div>
        </section>

        <aside className="project-checklist-panel">
          <button
            type="button"
            className="project-checklist-panel-toggle"
            onClick={() => setPanelOpen((current) => !current)}
            aria-label={panelOpen ? 'Close task panel' : 'Open task panel'}
            title={panelOpen ? 'Close task panel' : 'Open task panel'}
          >
            {panelOpen ? '›' : '‹'}
          </button>

          <div className="project-checklist-panel-inner">
            <div className="project-checklist-panel-title">
              {config.title}
            </div>

            <div className="project-checklist-divider" />

            <div className="project-checklist-check-title">
              {config.checklistTitle || 'TASKS WILL BE CHECKED BY THE TEACHER'}
              <span aria-hidden="true">ⓘ</span>
            </div>

            <div className="project-checklist-items">
              {checklist.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={`project-checklist-item ${checked[item.id] ? 'is-checked' : ''}`}
                  onClick={() => toggleChecked(item.id)}
                >
                  <span className="project-checklist-box">
                    {checked[item.id] ? '✓' : ''}
                  </span>

                  <span>
                    {index + 1}
                    .
                    {' '}
                    {item.text}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </article>
    </LmsActivityFrame>
  );
}