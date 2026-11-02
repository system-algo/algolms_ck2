import { useEffect, useMemo, useRef, useState } from 'react';
import TopNavigation from '../components/TopNavigation.jsx';
import ActivityRouter from '../activities/ActivityRouter.jsx';
import { saveTaskCompletionToSupabase } from '../lib/supabaseProgress.js';

function getStates(task) {
  return Array.isArray(task?.states) ? task.states : [];
}

function getTaskId(task) {
  return String(task?.id || task?.taskId || '').trim();
}

function getStateId(state) {
  return String(state?.id || state?.stateId || '').trim();
}

function resolveFrameConfig(pageInstance, task, state) {
  const taskId = getTaskId(task);
  const stateId = getStateId(state);

  const baseFrameConfig = pageInstance?.frameConfig || {};
  const taskFrameConfig = taskId
    ? pageInstance?.taskRenderers?.[taskId]?.frameConfig || {}
    : {};
  const stateFrameConfig = taskId && stateId
    ? pageInstance?.taskRenderers?.[taskId]?.states?.[stateId]?.frameConfig || {}
    : {};

  return {
    ...baseFrameConfig,
    ...taskFrameConfig,
    ...stateFrameConfig,
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function getRuntimeActivityMapUrl(pageInstance, fallback) {
  const courseId = String(pageInstance?.course?.id || fallback.courseId || '').trim();
  const lessonId = String(pageInstance?.lesson?.id || fallback.lessonId || '').trim();
  const pageId = String(pageInstance?.page?.id || fallback.pageId || '').trim();

  if (!courseId || !lessonId || !pageId) {
    return '';
  }

  return `/manual-activity-maps/${encodeURIComponent(courseId)}/${encodeURIComponent(lessonId)}/${encodeURIComponent(pageId)}.activity-map.json`;
}

function applyManualActivityMapToPageInstance(pageInstance, activityMap) {
  if (!pageInstance || !activityMap?.tasks) {
    return pageInstance;
  }

  const nextPageInstance = cloneJson(pageInstance);
  nextPageInstance.taskRenderers = nextPageInstance.taskRenderers || {};

  for (const [taskId, taskConfig] of Object.entries(activityMap.tasks || {})) {
    const selectedTaskType = String(taskConfig?.selectedType || '').trim();

    if (!nextPageInstance.taskRenderers[taskId]) {
      nextPageInstance.taskRenderers[taskId] = {
        type: selectedTaskType || 'generic-captured-task',
        manualSelectedType: selectedTaskType || 'generic-captured-task',
        states: {},
      };
    }

    if (selectedTaskType) {
      nextPageInstance.taskRenderers[taskId].type = selectedTaskType;
      nextPageInstance.taskRenderers[taskId].manualSelectedType = selectedTaskType;

      if (nextPageInstance.taskRenderers[taskId].states) {
        Object.keys(nextPageInstance.taskRenderers[taskId].states).forEach((sId) => {
          nextPageInstance.taskRenderers[taskId].states[sId].type = selectedTaskType;
          nextPageInstance.taskRenderers[taskId].states[sId].manualSelectedType = selectedTaskType;
        });
      }
    }

    nextPageInstance.taskRenderers[taskId].states =
      nextPageInstance.taskRenderers[taskId].states || {};

    for (const [stateId, stateConfig] of Object.entries(taskConfig.states || {})) {
      const selectedStateType = String(stateConfig?.selectedType || '').trim() || selectedTaskType;

      if (!selectedStateType) continue;

      if (!nextPageInstance.taskRenderers[taskId].states[stateId]) {
        nextPageInstance.taskRenderers[taskId].states[stateId] = {};
      }

      nextPageInstance.taskRenderers[taskId].states[stateId].type = selectedStateType;
      nextPageInstance.taskRenderers[taskId].states[stateId].manualSelectedType = selectedStateType;
    }
  }

  nextPageInstance.runtimeManualActivityMap = {
    applied: true,
    pageId: activityMap.pageId || '',
    updatedAt: activityMap.updatedAt || '',
  };

  return nextPageInstance;
}

function applyManualActivityMapToManifest(manifest, activityMap) {
  if (!manifest || !activityMap?.tasks || !Array.isArray(manifest.tasks)) {
    return manifest;
  }

  const nextManifest = cloneJson(manifest);
  const allowedTaskIds = new Set(Object.keys(activityMap.tasks || {}));

  if (allowedTaskIds.size > 0) {
    nextManifest.tasks = nextManifest.tasks.filter((task) => {
      const taskId = String(task?.taskId || task?.id || '').trim();
      if (!allowedTaskIds.has(taskId)) return false;
      const taskConfig = activityMap.tasks?.[taskId];
      if (taskConfig?.hidden || taskConfig?.disabled) return false;
      return true;
    });
  }

  nextManifest.tasks = nextManifest.tasks.map((task) => {
    const taskId = String(task?.taskId || task?.id || '').trim();
    const taskConfig = activityMap.tasks?.[taskId];

    if (!taskConfig) return task;

    const { states: manualStates = {}, ...taskConfigFields } = taskConfig;
    const selectedType = String(taskConfig.selectedType || '').trim();

    return {
      ...task,
      ...taskConfigFields,
      selectedType: selectedType || task.selectedType || task.activityType,
    };
  });

  return nextManifest;
}

function getCompletedTasksStorageKey(courseId, lessonId, pageId, studentEmail) {
  const user = String(studentEmail || '').trim().toLowerCase();
  if (!user) {
    return [
      'lms-completed-tasks:v2:anonymous',
      String(courseId || ''),
      String(lessonId || ''),
      String(pageId || ''),
    ].join(':');
  }
  return [
    'lms-completed-tasks:v2',
    user,
    String(courseId || ''),
    String(lessonId || ''),
    String(pageId || ''),
  ].join(':');
}

function loadCompletedTaskIds(storageKey, fallbackKeys = []) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(saved) && saved.length > 0) {
      return saved.map(String).filter(Boolean);
    }
    for (const fb of fallbackKeys) {
      const fbVal = JSON.parse(localStorage.getItem(fb) || '[]');
      if (Array.isArray(fbVal) && fbVal.length > 0) {
        return fbVal.map(String).filter(Boolean);
      }
    }
    return [];
  } catch {
    return [];
  }
}

function getFetchUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return String(input?.url || '');
}

function getFetchMethod(input, init) {
  return String(init?.method || input?.method || 'GET').toUpperCase();
}

function getFetchPayload(input, init) {
  const body = init?.body ?? input?.body;
  if (typeof body !== 'string' || !body.trim()) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function getGradingResult(responseData) {
  return (
    responseData?.result ||
    responseData?.data?.result ||
    responseData?.data ||
    responseData ||
    null
  );
}

export default function GeneratedPageShell({
  manifestUrl,
  pageInstanceUrl,
  courseId = '',
  lessonId = '',
  pageId = '',
  onBackToPages,
}) {
  const [manifest, setManifest] = useState(null);
  const [pageInstance, setPageInstance] = useState(null);
  const [error, setError] = useState('');
  const [taskIndex, setTaskIndex] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlTask = params.get('task');
      if (urlTask !== null && !isNaN(Number(urlTask))) {
        return Math.max(0, parseInt(urlTask, 10));
      }

      const cId = courseId || params.get('course') || '';
      const lId = lessonId || params.get('lesson') || '';
      const pId = pageId || params.get('page') || '';
      const storageKey = `algo_active_task:${cId}:${lId}:${pId}`;
      const saved = sessionStorage.getItem(storageKey);
      if (saved !== null && !isNaN(Number(saved))) {
        return Math.max(0, parseInt(saved, 10));
      }
    } catch {}
    return 0;
  });
  const [stateIndex, setStateIndex] = useState(0);
  const [rawMode, setRawMode] = useState(false);

  const studentEmail = useMemo(() => {
    return String(
      sessionStorage.getItem('lms_student_email') ||
      localStorage.getItem('lms_student_email') ||
      new URLSearchParams(window.location.search).get('studentEmail') ||
      new URLSearchParams(window.location.search).get('email') ||
      ''
    ).trim().toLowerCase();
  }, []);

  const effectiveCourseId = manifest?.metadata?.courseId || courseId || 'CK';
  const effectiveLessonId = manifest?.metadata?.lessonId || lessonId;
  const effectivePageId = manifest?.metadata?.pageId || pageId;

  const completedTasksStorageKey = useMemo(
    () => getCompletedTasksStorageKey(effectiveCourseId, effectiveLessonId, effectivePageId, studentEmail),
    [effectiveCourseId, effectiveLessonId, effectivePageId, studentEmail],
  );

  const legacyTasksStorageKey = useMemo(
    () => `lms-completed-tasks:${effectiveCourseId}:${effectiveLessonId}:${effectivePageId}`,
    [effectiveCourseId, effectiveLessonId, effectivePageId],
  );

  const [completedTaskIds, setCompletedTaskIds] = useState(() =>
    loadCompletedTaskIds(completedTasksStorageKey, [legacyTasksStorageKey])
  );
  const completedTaskIdsRef = useRef(completedTaskIds);
  completedTaskIdsRef.current = completedTaskIds;

  const [justCompletedTaskId, setJustCompletedTaskId] = useState('');
  const justCompletedTaskIdRef = useRef('');
  justCompletedTaskIdRef.current = justCompletedTaskId;

  const [progressJustIncreased, setProgressJustIncreased] = useState(false);
  const [progressCelebrationKey, setProgressCelebrationKey] = useState(0);

  const currentTaskIdRef = useRef('');
  const autoTransitionTimerRef = useRef(null);
  const taskIndexRef = useRef(taskIndex);
  taskIndexRef.current = taskIndex;
  const tasksRef = useRef([]);

  useEffect(() => {
    return () => {
      if (autoTransitionTimerRef.current) {
        clearTimeout(autoTransitionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const cId = courseId;
    const lId = lessonId;
    const pId = pageId;
    if (!pId) return;

    try {
      const storageKey = `algo_active_task:${cId}:${lId}:${pId}`;
      sessionStorage.setItem(storageKey, String(taskIndex));

      const url = new URL(window.location.href);
      if (url.searchParams.get('task') !== String(taskIndex)) {
        url.searchParams.set('task', String(taskIndex));
        window.history.replaceState({}, '', url.toString());
      }
    } catch {}
  }, [taskIndex, courseId, lessonId, pageId]);

  useEffect(() => {
    const ids = loadCompletedTaskIds(completedTasksStorageKey, [legacyTasksStorageKey]);
    setCompletedTaskIds(ids);
    completedTaskIdsRef.current = ids;

    const supabaseUrl =
      sessionStorage.getItem('lms_supabase_url') ||
      localStorage.getItem('lms_supabase_url');
    const supabaseKey =
      sessionStorage.getItem('lms_supabase_key') ||
      localStorage.getItem('lms_supabase_key');

    if (supabaseUrl && supabaseKey && studentEmail && effectivePageId) {
      const url = `${supabaseUrl}/rest/v1/activity_progress?user_id=eq.${encodeURIComponent(studentEmail)}&page_id=eq.${encodeURIComponent(effectivePageId)}&select=task_id,status,is_completed`;
      const accessToken =
        sessionStorage.getItem('lms_access_token') ||
        localStorage.getItem('lms_access_token');
      const headers = {
        apikey: supabaseKey,
      };
      if (accessToken && accessToken.split('.').length === 3) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      fetch(url, { headers })
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          if (Array.isArray(data)) {
            const dbCompletedIds = data
              .filter(
                (r) =>
                  r.is_completed === true ||
                  String(r.is_completed) === 'true' ||
                  r.status === 'completed' ||
                  r.status === 'correct' ||
                  r.status === 'passed',
              )
              .map((r) => String(r.task_id))
              .filter(Boolean);

            setCompletedTaskIds((prev) => {
              const currentJustCompleted = justCompletedTaskIdRef.current ? [justCompletedTaskIdRef.current] : [];
              const finalIds = Array.from(new Set([...prev, ...dbCompletedIds, ...currentJustCompleted]));
              try {
                localStorage.setItem(completedTasksStorageKey, JSON.stringify(finalIds));
                localStorage.setItem(legacyTasksStorageKey, JSON.stringify(finalIds));
              } catch (e) {}
              completedTaskIdsRef.current = finalIds;
              return finalIds;
            });
          }
        })
        .catch((err) => console.warn('[GeneratedPageShell] Failed to load Supabase page progress:', err));
    }
  }, [completedTasksStorageKey, legacyTasksStorageKey, effectiveCourseId, effectiveLessonId, effectivePageId, studentEmail]);

  useEffect(() => {
    let isCancelled = false;

    async function loadPage() {
      try {
        const manifestResponse = await fetch(manifestUrl);

        if (!manifestResponse.ok) {
          throw new Error(`Cannot load ${manifestUrl}`);
        }

        const nextManifest = await manifestResponse.json();

        const pageInstanceResponse = await fetch(pageInstanceUrl);
        const nextPageInstance = pageInstanceResponse.ok
          ? await pageInstanceResponse.json()
          : {
              schemaVersion: 0,
              pageInstanceId: 'legacy',
              frameConfig: {},
              taskRenderers: {},
            };

        let finalManifest = nextManifest;
        let finalPageInstance = nextPageInstance;

        const activityMapUrl = getRuntimeActivityMapUrl(nextPageInstance, {
          courseId,
          lessonId,
          pageId,
        });

        if (activityMapUrl) {
          try {
            const activityMapResponse = await fetch(`${activityMapUrl}?t=${Date.now()}`);

            if (activityMapResponse.ok) {
              const activityMap = await activityMapResponse.json();

              finalPageInstance = applyManualActivityMapToPageInstance(nextPageInstance, activityMap);
              finalManifest = applyManualActivityMapToManifest(nextManifest, activityMap);
            } else {
              console.warn(`Manual activity map not found: ${activityMapUrl}`);
            }
          } catch (mapError) {
            console.warn('Cannot load manual activity map:', mapError);
          }
        }

        if (isCancelled) return;

        setManifest(finalManifest);
        setPageInstance(finalPageInstance);
      } catch (err) {
        if (isCancelled) return;
        setError(err.message);
      }
    }

    loadPage();

    return () => {
      isCancelled = true;
    };
  }, [manifestUrl, pageInstanceUrl, courseId, lessonId, pageId]);

  const tasks = useMemo(() => {
    return Array.isArray(manifest?.tasks) ? manifest.tasks : [];
  }, [manifest]);

  useEffect(() => {
    if (tasks.length > 0 && taskIndex >= tasks.length) {
      setTaskIndex(Math.max(0, tasks.length - 1));
    }
  }, [tasks.length, taskIndex]);

  const task = tasks[taskIndex] || null;
  const states = getStates(task);
  const state = states[stateIndex] || null;

  useEffect(() => {
    currentTaskIdRef.current = getTaskId(task);
  }, [task]);

  taskIndexRef.current = taskIndex;
  tasksRef.current = tasks;

  const courseTitle = manifest?.metadata?.courseTitle || courseId || 'Course';
  const lessonTitle = manifest?.metadata?.lessonTitle || lessonId || 'Lesson';
  const pageTitle = manifest?.metadata?.pageTitle || pageId || 'Page';

  const frameConfig = useMemo(() => {
    return resolveFrameConfig(pageInstance, task, state);
  }, [pageInstance, task, state]);

  const progressLabel = useMemo(() => {
    if (!task || !tasks.length) return '';
    return `${taskIndex + 1}/${tasks.length}`;
  }, [task, tasks.length, taskIndex]);

  const completedTaskCount = useMemo(() => {
    if (!tasks.length) return 0;
    const taskIdSet = new Set(tasks.map((item) => getTaskId(item)).filter(Boolean));
    return completedTaskIds.filter((id) => taskIdSet.has(String(id))).length;
  }, [completedTaskIds, tasks]);

  const lessonProgressPercent = useMemo(() => {
    if (!tasks.length) return 0;
    return Math.round((completedTaskCount / tasks.length) * 100);
  }, [completedTaskCount, tasks.length]);

  function gotoTask(nextTaskIndex) {
    if (autoTransitionTimerRef.current) clearTimeout(autoTransitionTimerRef.current);
    setTaskIndex(nextTaskIndex);
    setStateIndex(0);
  }

  function prevTask() {
    if (autoTransitionTimerRef.current) clearTimeout(autoTransitionTimerRef.current);
    if (!tasks.length) return;
    setTaskIndex(Math.max(0, taskIndex - 1));
    setStateIndex(0);
  }

  function nextTask() {
    if (autoTransitionTimerRef.current) clearTimeout(autoTransitionTimerRef.current);
    if (!tasks.length) return;
    if (taskIndex < tasks.length - 1) {
      setTaskIndex(taskIndex + 1);
      setStateIndex(0);
    }
  }

  function prevState() {
    if (!task || !tasks.length) return;

    if (stateIndex > 0) {
      setStateIndex(stateIndex - 1);
      return;
    }

    if (taskIndex > 0) {
      const prevTaskIndex = taskIndex - 1;
      const prevTaskData = tasks[prevTaskIndex];
      const prevStates = getStates(prevTaskData);

      setTaskIndex(prevTaskIndex);
      setStateIndex(Math.max(0, prevStates.length - 1));
    }
  }

  function nextState() {
    if (!task || !tasks.length) return;

    if (stateIndex < states.length - 1) {
      setStateIndex(stateIndex + 1);
      return;
    }

    if (taskIndex < tasks.length - 1) {
      setTaskIndex(taskIndex + 1);
      setStateIndex(0);
    }
  }

  const handleBackToCourse = () => {
    const target = effectiveLessonId || lessonId || '';
    if (typeof onBackToPages === 'function') {
      onBackToPages(target);
    }
  };

  const taskRef = useRef(task);
  taskRef.current = task;

  function markTaskAsCompleted(taskId) {
    const completedId = String(taskId || '').trim();
    if (!completedId) return;

    const wasAlreadyCompleted = completedTaskIdsRef.current.includes(completedId);
    if (!wasAlreadyCompleted) {
      setJustCompletedTaskId(completedId);
      setProgressJustIncreased(true);
      setProgressCelebrationKey((prev) => prev + 1);

      saveTaskCompletionToSupabase({
        courseId: effectiveCourseId,
        lessonId: effectiveLessonId,
        pageId: effectivePageId,
        taskId: completedId,
      });

      setCompletedTaskIds((currentIds) => {
        if (currentIds.includes(completedId)) return currentIds;
        const nextIds = [...currentIds, completedId];
        try {
          localStorage.setItem(completedTasksStorageKey, JSON.stringify(nextIds));
          localStorage.setItem(legacyTasksStorageKey, JSON.stringify(nextIds));
          window.dispatchEvent(new StorageEvent('storage', { key: completedTasksStorageKey }));
        } catch (e) {}
        completedTaskIdsRef.current = nextIds;
        return nextIds;
      });

      if (taskIndexRef.current < tasksRef.current.length - 1) {
        if (autoTransitionTimerRef.current) {
          clearTimeout(autoTransitionTimerRef.current);
        }
        autoTransitionTimerRef.current = setTimeout(() => {
          setTaskIndex((prev) => Math.min(tasksRef.current.length - 1, prev + 1));
          setStateIndex(0);
        }, 1500);
      }
    }
  }

  function handleTaskCompleted(completionOrEvent = {}) {
    const currentTask = taskRef.current;
    const currentTaskIndex = taskIndexRef.current;

    const completedId = String(
      completionOrEvent?.detail?.taskId ||
      completionOrEvent?.taskId ||
      getTaskId(currentTask) ||
      `task-${currentTaskIndex + 1}`
    ).trim();

    markTaskAsCompleted(completedId);
  }

  // Intercept fetch to detect successful activity attempts (matching PTSY1)
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    async function trackedFetch(input, init) {
      const response = await originalFetch(input, init);

      try {
        const requestUrl = getFetchUrl(input);
        const requestMethod = getFetchMethod(input, init);

        const isActivitySubmission =
          response.ok &&
          requestMethod === 'POST' &&
          requestUrl.includes('/api/activity-attempts');

        if (isActivitySubmission) {
          let responseData = null;

          try {
            responseData = await response.clone().json();
          } catch {
            responseData = null;
          }

          const gradingResult = getGradingResult(responseData);

          if (gradingResult?.isCorrect === true || gradingResult?.status === 'correct' || responseData?.ok === true && (responseData?.result?.isCorrect === true || responseData?.isCorrect === true)) {
            const payload = getFetchPayload(input, init);

            const submittedTaskId = String(
              payload?.taskId ||
              payload?.answer?.taskId ||
              currentTaskIdRef.current ||
              '',
            ).trim();

            if (submittedTaskId) {
              markTaskAsCompleted(submittedTaskId);
            }
          }
        }
      } catch (trackingError) {
        console.warn('Could not update completed task indicator:', trackingError);
      }

      return response;
    }

    window.fetch = trackedFetch;

    return () => {
      if (window.fetch === trackedFetch) {
        window.fetch = originalFetch;
      }
    };
  }, [completedTasksStorageKey, legacyTasksStorageKey, effectiveCourseId, effectiveLessonId, effectivePageId]);

  useEffect(() => {
    function handleCustomEvent(e) {
      handleTaskCompleted(e);
    }
    window.addEventListener('LMS_TASK_COMPLETED', handleCustomEvent);
    return () => {
      window.removeEventListener('LMS_TASK_COMPLETED', handleCustomEvent);
    };
  }, []);

  if (error) {
    return (
      <main className="empty-screen">
        <h1>Page failed to load</h1>
        <p>{error}</p>

        <button type="button" onClick={handleBackToCourse}>
          Back to pages
        </button>
      </main>
    );
  }

  if (!manifest || !pageInstance || !task || !state) {
    return (
      <main className="empty-screen">
        <p>Loading page...</p>

        <button type="button" onClick={handleBackToCourse}>
          Back to pages
        </button>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <TopNavigation
        title={pageTitle}
        courseId={`${courseTitle} / ${lessonTitle}`}
        lessonTitle={lessonTitle}
        pageTitle={pageTitle}
        lessonId={manifest?.metadata?.lessonId || effectiveLessonId}
        pageId={manifest?.metadata?.pageId || effectivePageId}
        tasks={tasks}
        currentTaskIndex={taskIndex}
        completedTaskIds={completedTaskIds}
        completedTaskCount={completedTaskCount}
        totalTaskCount={tasks.length}
        lessonProgressPercent={lessonProgressPercent}
        justCompletedTaskId={justCompletedTaskId}
        progressJustIncreased={progressJustIncreased}
        progressCelebrationKey={progressCelebrationKey}
        onSelectTask={gotoTask}
        onBackToCatalog={handleBackToCourse}
      />

      <ActivityRouter
        pageInstance={pageInstance}
        frameConfig={frameConfig}
        task={task}
        state={state}
        stateIndex={stateIndex}
        rawMode={rawMode}
        completedTaskIds={completedTaskIds}
        isTaskCompleted={completedTaskIds.includes(String(getTaskId(task) || task?.id || task?.taskId || ''))}
        onNextTask={nextTask}
        onPrevTask={prevTask}
        onNextState={nextState}
        onPrevState={prevState}
        onSelectState={setStateIndex}
        onBackToPages={handleBackToCourse}
        onBackToCatalog={handleBackToCourse}
        onBackToCourse={handleBackToCourse}
        onTaskComplete={handleTaskCompleted}
        onTaskCompleted={handleTaskCompleted}
      />

      <button
        type="button"
        className="back-to-course-btn"
        onClick={handleBackToCourse}
        title="Back to course"
      >
        <span className="back-arrow">←</span> Back to course
      </button>

      <footer className="debug-bar">
        <span>{courseTitle}</span>
        <span>{lessonTitle}</span>
        <span>{pageTitle}</span>
        <span>{progressLabel}</span>
        <span>{task.selectedType || task.activityType}</span>
        <span>{pageInstance?.runtimeManualActivityMap?.applied ? 'manual map applied' : 'page instance only'}</span>

        <button type="button" onClick={() => setRawMode((value) => !value)}>
          {rawMode ? 'Use activity renderer' : 'Show raw capture'}
        </button>
      </footer>
    </div>
  );
}
