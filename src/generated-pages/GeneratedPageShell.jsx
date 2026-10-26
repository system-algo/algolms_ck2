import { useEffect, useMemo, useState } from 'react';
import TopNavigation from '../components/TopNavigation.jsx';
import ActivityRouter from '../activities/ActivityRouter.jsx';

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

  const effectiveCourseId = manifest?.metadata?.courseId || courseId;
  const effectiveLessonId = manifest?.metadata?.lessonId || lessonId;
  const effectivePageId = manifest?.metadata?.pageId || pageId;

  const completedTasksStorageKey = useMemo(
    () => `lms-completed-tasks:${effectiveCourseId}:${effectiveLessonId}:${effectivePageId}`,
    [effectiveCourseId, effectiveLessonId, effectivePageId],
  );

  const [completedTaskIds, setCompletedTaskIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`lms-completed-tasks:${courseId}:${lessonId}:${pageId}`) || '[]');
      return Array.isArray(saved) ? saved.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(completedTasksStorageKey) || '[]');
      if (Array.isArray(saved)) {
        setCompletedTaskIds(saved.map(String).filter(Boolean));
      }
    } catch {}
  }, [completedTasksStorageKey]);

  useEffect(() => {
    function handleTaskCompleted(event) {
      const completedId = String(event?.detail?.taskId || '').trim();
      if (!completedId) return;

      setCompletedTaskIds((prev) => {
        if (prev.includes(completedId)) return prev;
        const next = [...prev, completedId];
        try {
          localStorage.setItem(completedTasksStorageKey, JSON.stringify(next));
        } catch {}
        return next;
      });

      // Sync to Supabase activity_progress table
      import('../lib/supabaseProgress.js')
        .then(({ saveTaskCompletionToSupabase }) => {
          saveTaskCompletionToSupabase({
            courseId: effectiveCourseId,
            lessonId: effectiveLessonId,
            pageId: effectivePageId,
            taskId: completedId,
          });
        })
        .catch(() => {});
    }

    window.addEventListener('LMS_TASK_COMPLETED', handleTaskCompleted);
    return () => {
      window.removeEventListener('LMS_TASK_COMPLETED', handleTaskCompleted);
    };
  }, [completedTasksStorageKey, effectiveCourseId, effectiveLessonId, effectivePageId]);

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

  function gotoTask(nextTaskIndex) {
    setTaskIndex(nextTaskIndex);
    setStateIndex(0);
  }

  function prevTask() {
    if (!tasks.length) return;
    setTaskIndex(Math.max(0, taskIndex - 1));
    setStateIndex(0);
  }

  function nextTask() {
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
        lessonId={manifest?.metadata?.lessonId || lessonId}
        pageId={manifest?.metadata?.pageId || pageId}
        tasks={tasks}
        currentTaskIndex={taskIndex}
        completedTaskIds={completedTaskIds}
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
        onNextTask={nextTask}
        onPrevTask={prevTask}
        onNextState={nextState}
        onPrevState={prevState}
        onSelectState={setStateIndex}
        onBackToPages={handleBackToCourse}
        onBackToCatalog={handleBackToCourse}
        onBackToCourse={handleBackToCourse}
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