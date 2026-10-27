import { useEffect, useState } from 'react';
import { buildAuthenticatedActivityAttempt } from './ck2BackendAttempt.js';
import { resolveActivityMapUrl } from './taskExtractors.js';

/**
 * Shared runtime helpers for the CK2 lesson 10-32 activities
 * (CanvasDropTask, CategoryDragTask, CardArrangementTask).
 *
 * They follow the same contract as ImageDropzonesTask / SceneClassificationTask:
 *  - config comes from the page's manual activity map (tasks[taskId][configKey])
 *  - the answer is graded by the backend (POST /api/activity-attempts)
 *  - progress is saved through supabaseProgress.saveTaskCompletionToSupabase
 */

export function getTaskId(task) {
  return String(task?.id || task?.taskId || '').trim();
}

export function getBackendBaseUrl() {
  return String(
    import.meta.env.VITE_API_BASE_URL ||
      import.meta.env.VITE_API_URL ||
      sessionStorage.getItem('lms_backend_url') ||
      localStorage.getItem('lms_backend_url') ||
      ''
  )
    .trim()
    .replace(/\/+$/, '');
}

export function getRuntimeIds(pageInstance) {
  let courseId = '';
  let lessonId = '';
  let pageId = '';

  try {
    const params = new URLSearchParams(window.location.search);
    courseId = params.get('course') || '';
    lessonId = params.get('lesson') || '';
    pageId = params.get('page') || '';
  } catch {
    // Fall back to pageInstance below.
  }

  return {
    courseId: courseId || pageInstance?.courseId || pageInstance?.course?.id || pageInstance?.course || '',
    lessonId: lessonId || pageInstance?.lessonId || pageInstance?.lesson?.id || pageInstance?.lesson || '',
    pageId: pageId || pageInstance?.pageId || pageInstance?.page?.id || pageInstance?.id || '',
  };
}

function getManualMapUrl(pageInstance) {
  const fromPage = resolveActivityMapUrl(pageInstance?.manualActivityMap || pageInstance?.manualMapUrl);
  if (fromPage) return fromPage;

  const { courseId, lessonId, pageId } = getRuntimeIds(pageInstance);
  if (courseId && lessonId && pageId) {
    return `/manual-activity-maps/${encodeURIComponent(courseId)}/${encodeURIComponent(
      lessonId,
    )}/${encodeURIComponent(pageId)}.activity-map.json`;
  }
  return '';
}

/**
 * Loads tasks[taskId][configKey] from the page's activity map.
 * Returns the config object, or null while loading / when missing.
 */
export function useManualTaskConfig(task, pageInstance, configKeys) {
  const taskId = getTaskId(task);
  const [config, setConfig] = useState(null);
  const keysSignature = configKeys.join('|');

  useEffect(() => {
    let cancelled = false;
    setConfig(null);

    const url = getManualMapUrl(pageInstance);
    if (!url || !taskId) return undefined;

    fetch(url)
      .then((response) => (response.ok ? response.json() : null))
      .then((manualMap) => {
        if (cancelled || !manualMap) return;
        const manualTask = manualMap?.tasks?.[taskId] || null;
        const next = configKeys.map((key) => manualTask?.[key]).find(Boolean) || null;
        setConfig(next);
      })
      .catch(() => {
        if (!cancelled) setConfig(null);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageInstance, taskId, keysSignature]);

  return config;
}

/**
 * Sends the answer to the backend and resolves only when the backend
 * confirms it saved AND graded the answer as correct.
 */
export async function submitGradedAttempt({ task, pageInstance, activityType, answer }) {
  const apiBaseUrl = getBackendBaseUrl();
  if (!apiBaseUrl) throw new Error('LMS backend URL is not configured.');

  const { courseId, lessonId, pageId } = getRuntimeIds(pageInstance);
  const studentEmail =
    sessionStorage.getItem('lms_student_email') || localStorage.getItem('lms_student_email') || '';
  const accessToken =
    sessionStorage.getItem('lms_access_token') || localStorage.getItem('lms_access_token') || '';
  const taskId = getTaskId(task);

  const { headers, payload } = buildAuthenticatedActivityAttempt({
    accessToken,
    studentEmail,
    courseId: courseId || 'CK',
    lessonId,
    pageId,
    taskId,
    activityType,
    answer,
    extra: { isCorrect: true, score: 1, maxScore: 1 },
  });

  const response = await fetch(`${apiBaseUrl}/api/activity-attempts`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const saved = await response.json();
  if (saved?.ok !== true) {
    throw new Error('Backend did not confirm saving the attempt.');
  }
  if (saved?.result?.isCorrect !== true) {
    throw new Error(`Backend did not grade the answer as right: ${saved?.result?.status || 'unknown'}`);
  }
  return saved;
}

/**
 * Same completion side effects as the other CK2 activities:
 * LMS event, sound, onTaskCompleted callback, Supabase progress, auto-advance.
 */
export function notifyTaskCompleted({
  task,
  pageInstance,
  activityType,
  metadata,
  onTaskCompleted,
  onTaskComplete,
  onNextTask,
}) {
  const taskId = getTaskId(task);

  window.dispatchEvent(new CustomEvent('LMS_TASK_COMPLETED', { detail: { taskId } }));

  import('../utils/lmsSounds.js')
    .then(({ playLmsSound, LMS_SOUND_TYPES }) => {
      playLmsSound(LMS_SOUND_TYPES.COMPLETE_ACTIVITY);
    })
    .catch(() => {});

  const completionPayload = {
    taskId,
    activityType,
    completionType: 'correct',
    isCorrect: true,
    score: 1,
    maxScore: 1,
    feedback: 'Correct!',
    metadata,
  };

  if (typeof onTaskCompleted === 'function') {
    onTaskCompleted(completionPayload);
  } else if (typeof onTaskComplete === 'function') {
    onTaskComplete(completionPayload);
  }

  const { courseId, lessonId, pageId } = getRuntimeIds(pageInstance);
  import('./supabaseProgress.js')
    .then(({ saveTaskCompletionToSupabase }) => {
      if (typeof saveTaskCompletionToSupabase === 'function' && courseId && lessonId && pageId) {
        saveTaskCompletionToSupabase({
          courseId,
          lessonId,
          pageId,
          taskId,
          isCompleted: true,
        }).catch(() => {});
      }
    })
    .catch(() => {});

  if (onNextTask) {
    setTimeout(onNextTask, 1200);
  }
}
