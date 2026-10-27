import { useEffect, useMemo, useState } from 'react';
import './IdeaListTask.css';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import { buildAuthenticatedActivityAttempt } from '../lib/ck2BackendAttempt.js';
import {
  loadLocalTaskState,
  saveLocalTaskState,
  resolveActivityMapUrl,
} from '../lib/taskExtractors.js';

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTaskId(task) {
  return String(task?.id || task?.taskId || '').trim();
}

function getBackendBaseUrl() {
  return String(
    import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL ||
    sessionStorage.getItem('lms_backend_url') || localStorage.getItem('lms_backend_url') || ''
  ).trim().replace(/\/+$/, '');
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


function getManualMapUrl(pageInstance) {
  return resolveActivityMapUrl(pageInstance?.manualActivityMap);
}

function createEmptyItem() {
  return {
    id: `idea-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: '',
  };
}

function normalizeItem(item, index) {
  if (typeof item === 'string') {
    return {
      id: `idea-${index + 1}`,
      text: item,
    };
  }

  return {
    id: String(item?.id || `idea-${index + 1}`),
    text: String(item?.text || item?.value || item?.title || ''),
  };
}

function getFallbackConfig(task) {
  return {
    title: task?.title || 'Ideas',
    placeholder: '',
    initialItems: [''],
  };
}

function getConfigFromTask(task) {
  return task?.ideaList || task?.ideas || task?.dynamicTextList || null;
}

export default function IdeaListTask({
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
          manualTask?.ideaList ||
          manualTask?.ideas ||
          manualTask?.dynamicTextList ||
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
    const rawItems = Array.isArray(config.initialItems)
      ? config.initialItems
      : Array.isArray(config.items)
        ? config.items
        : [''];

    const items = rawItems.map(normalizeItem);

    return items.length ? items : [createEmptyItem()];
  }, [config]);

  const [items, setItems] = useState(() => {
    const saved = loadLocalTaskState(taskId, null);

    if (Array.isArray(saved?.items) && saved.items.length) {
      return saved.items;
    }

    return initialItems;
  });

  const [status, setStatus] = useState('');

  useEffect(() => {
    const saved = loadLocalTaskState(taskId, null);

    if (Array.isArray(saved?.items) && saved.items.length) {
      setItems(saved.items);
      setStatus(saved?.status || '');
      return;
    }

    setItems(initialItems);
    setStatus('');
  }, [taskId, initialItems]);

  useEffect(() => {
    if (items.some(it => Boolean(it.text || it.value))) {
      saveLocalTaskState(taskId, {
        items,
        status,
      });
    }
  }, [taskId, items, status]);

  function addItem() {
    setItems((current) => [
      ...current,
      createEmptyItem(),
    ]);
    setStatus('');
  }

  function updateItem(itemId, value) {
    setItems((current) => current.map((item) => (
      item.id === itemId
        ? {
          ...item,
          text: value,
        }
        : item
    )));
    setStatus('');
  }

  function deleteItem(itemId) {
    setItems((current) => {
      const next = current.filter((item) => item.id !== itemId);

      if (!next.length) {
        return [createEmptyItem()];
      }

      return next;
    });
    setStatus('');
  }

  async function saveItems() {
    saveLocalTaskState(task.id, { items, status: 'Saved locally.' });
    setStatus('Saving your answer...');
    try {
      const apiBaseUrl = getBackendBaseUrl();
      if (!apiBaseUrl) throw new Error('LMS backend is not configured.');
      const { courseId, lessonId, pageId } = getRuntimeIds(pageInstance);
      const currentTaskId = taskId || getTaskId(task);
      const studentEmail =
        sessionStorage.getItem('lms_student_email') ||
        localStorage.getItem('lms_student_email') || '';
      const accessToken =
        sessionStorage.getItem('lms_access_token') ||
        localStorage.getItem('lms_access_token') || '';
      const { headers, payload } = buildAuthenticatedActivityAttempt({
        studentEmail, accessToken, courseId, lessonId, pageId,
        taskId: currentTaskId,
        activityType: 'idea-list-task',
        answer: { items },
      });
      const attempt = await fetch(`${apiBaseUrl}/api/activity-attempts`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!attempt.ok || (await attempt.json())?.ok !== true) {
        throw new Error('Could not save the ideas on the backend.');
      }
      const completion = await fetch(`${apiBaseUrl}/api/activity-completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...payload,
          completionType: 'completed',
          metadata: { source: 'idea-list-task' },
        }),
      });
      if (!completion.ok || (await completion.json())?.ok !== true) {
        throw new Error('Could not mark the idea list complete.');
      }
      if (!isAlreadyDone) {
        setLocalCompleted(true);
        import('../utils/lmsSounds.js')
          .then(({ playLmsSound, LMS_SOUND_TYPES }) => {
            playLmsSound(LMS_SOUND_TYPES.COMPLETE_ACTIVITY);
          })
          .catch(() => {});
        window.dispatchEvent(
          new CustomEvent('LMS_TASK_COMPLETED', { detail: { taskId: currentTaskId } })
        );
      }
      setStatus('Saved.');
    } catch (error) {
      console.error('[IdeaListTask] Backend save failed:', error);
      setStatus('Saved locally, but not on the backend. Please retry.');
    }
  }

  function resetItems() {
    setItems(initialItems);
    setStatus('');
  }

  return (
    <LmsActivityFrame
      title={config.title || fallbackConfig.title}
      status={status}
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
      onCheck={saveItems}
      onReset={resetItems}
      footer={null}
      isTaskDone={isTaskDone}
    >
      <article className="idea-list-task">
        <section className="idea-list-board">
          <header className="idea-list-header">
            <div className="idea-list-title-row">
              <span className="idea-list-title-icon">✎</span>
              <h1>{config.title || fallbackConfig.title}</h1>
            </div>

            {config.helperText ? (
              <p>{config.helperText}</p>
            ) : null}
          </header>

          <div className="idea-list-items">
            {items.map((item) => (
              <div key={item.id} className="idea-list-row">
                <textarea
                  className="idea-list-input"
                  value={item.text}
                  placeholder={config.placeholder || ''}
                  onChange={(event) => updateItem(item.id, event.target.value)}
                  rows={1}
                />

                <button
                  type="button"
                  className="idea-list-delete"
                  onClick={() => deleteItem(item.id)}
                  aria-label="Delete idea"
                  title="Delete"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="idea-list-toolbar">
            <button
              type="button"
              className="idea-list-tool-button"
              onClick={addItem}
              aria-label="Add text box"
              title="Add"
            >
              +
            </button>
          </div>
        </section>
      </article>
    </LmsActivityFrame>
  );
}