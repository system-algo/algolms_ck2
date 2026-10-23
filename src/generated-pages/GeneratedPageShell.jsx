import { useEffect, useMemo, useRef, useState } from 'react';
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
  const stateFrameConfig =
    taskId && stateId
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

  return `/manual-activity-maps/${encodeURIComponent(courseId)}/${encodeURIComponent(
    lessonId,
  )}/${encodeURIComponent(pageId)}.activity-map.json`;
}

function applyManualActivityMapToPageInstance(pageInstance, activityMap) {
  if (!pageInstance || !activityMap) return pageInstance;

  const nextPageInstance = {
    ...pageInstance,
    taskRenderers: {
      ...(pageInstance.taskRenderers || {}),
    },
  };

  const manualTasks = activityMap.tasks || {};

  Object.entries(manualTasks).forEach(([taskId, taskConfig]) => {
    if (!taskConfig) return;

    const selectedTaskType = String(taskConfig.selectedType || '').trim();

    if (!nextPageInstance.taskRenderers[taskId]) {
      nextPageInstance.taskRenderers[taskId] = {};
    }

    const taskRenderer = nextPageInstance.taskRenderers[taskId];

    if (selectedTaskType) {
      taskRenderer.type = selectedTaskType;
      taskRenderer.selectedType = selectedTaskType;
      taskRenderer.manualSelectedType = selectedTaskType;
    }

    if (taskConfig.frameConfig) {
      taskRenderer.frameConfig = taskConfig.frameConfig;
    }

    if (taskConfig.matchingConnect) {
      taskRenderer.matchingConnect = taskConfig.matchingConnect;
    }

    if (taskConfig.matchingDragdrop) {
      taskRenderer.matchingDragdrop = taskConfig.matchingDragdrop;
    }

    if (taskConfig.mcqCheckbox) {
      taskRenderer.mcqCheckbox = taskConfig.mcqCheckbox;
    }

    if (taskConfig.categoryDragdrop) {
      taskRenderer.categoryDragdrop = taskConfig.categoryDragdrop;
    }

    if (taskConfig.typingPractice) {
      taskRenderer.typingPractice = taskConfig.typingPractice;
    }

    if (taskConfig.teacherChecklist) {
      taskRenderer.teacherChecklist = taskConfig.teacherChecklist;
    }

    const manualStates = taskConfig.states || {};

    taskRenderer.states = {
      ...(taskRenderer.states || {}),
    };

    Object.entries(manualStates).forEach(([stateId, stateConfig]) => {
      if (!stateConfig) return;

      const selectedStateType =
        String(stateConfig.selectedType || '').trim() || selectedTaskType;

      if (!taskRenderer.states[stateId]) {
        taskRenderer.states[stateId] = {};
      }

      const stateRenderer = taskRenderer.states[stateId];

      if (selectedStateType) {
        stateRenderer.type = selectedStateType;
        stateRenderer.selectedType = selectedStateType;
        stateRenderer.manualSelectedType = selectedStateType;
      }

      if (stateConfig.frameConfig) {
        stateRenderer.frameConfig = stateConfig.frameConfig;
      }

      if (stateConfig.matchingConnect) {
        stateRenderer.matchingConnect = stateConfig.matchingConnect;
      }

      if (stateConfig.matchingDragdrop) {
        stateRenderer.matchingDragdrop = stateConfig.matchingDragdrop;
      }

      if (stateConfig.mcqCheckbox) {
        stateRenderer.mcqCheckbox = stateConfig.mcqCheckbox;
      }

      if (stateConfig.categoryDragdrop) {
        stateRenderer.categoryDragdrop = stateConfig.categoryDragdrop;
      }

      if (stateConfig.typingPractice) {
        stateRenderer.typingPractice = stateConfig.typingPractice;
      }

      if (stateConfig.teacherChecklist) {
        stateRenderer.teacherChecklist = stateConfig.teacherChecklist;
      }
    });
  });

  return nextPageInstance;
}

function applyManualActivityMapToManifest(manifest, activityMap) {
  if (!manifest || !activityMap?.tasks || !Array.isArray(manifest.tasks)) {
    return manifest;
  }

  const nextManifest = cloneJson(manifest);

  nextManifest.tasks = nextManifest.tasks.map((task) => {
    const taskId = String(task?.taskId || task?.id || '').trim();
    const taskConfig = activityMap.tasks?.[taskId];

    if (!taskConfig) return task;

    const selectedType = String(taskConfig.selectedType || '').trim();

    return {
      ...task,
      selectedType: selectedType || task.selectedType || task.activityType,
    };
  });

  return nextManifest;
}

function resolveCurrentRendererType(task, state, pageInstance) {
  const taskId = getTaskId(task);
  const stateId = getStateId(state);

  const stateType =
    state?.selectedType ||
    state?.type ||
    pageInstance?.taskRenderers?.[taskId]?.states?.[stateId]?.selectedType ||
    pageInstance?.taskRenderers?.[taskId]?.states?.[stateId]?.type;

  if (stateType) {
    return String(stateType).trim();
  }

  const taskType =
    task?.selectedType ||
    task?.activityType ||
    pageInstance?.taskRenderers?.[taskId]?.selectedType ||
    pageInstance?.taskRenderers?.[taskId]?.type;

  return String(taskType || '').trim();
}


function getCompletedTasksStorageKey(courseId, lessonId, pageId) {
  return [
    'lms-completed-tasks',
    String(courseId || ''),
    String(lessonId || ''),
    String(pageId || ''),
  ].join(':');
}

function loadCompletedTaskIds(storageKey) {
  try {
    const savedValue = JSON.parse(localStorage.getItem(storageKey) || '[]');

    if (!Array.isArray(savedValue)) {
      return [];
    }

    return savedValue.map(String).filter(Boolean);
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
  return String(
    init?.method ||
    input?.method ||
    'GET',
  ).toUpperCase();
}

function getFetchPayload(input, init) {
  const body = init?.body ?? input?.body;

  if (typeof body !== 'string' || !body.trim()) {
    return null;
  }

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
  onBackToLessons,
  onBackToCourses,
}) {
  const [manifest, setManifest] = useState(null);
  const [pageInstance, setPageInstance] = useState(null);
  const [error, setError] = useState('');
  const [taskIndex, setTaskIndex] = useState(0);
  const [stateIndex, setStateIndex] = useState(0);
  const completedTasksStorageKey = useMemo(
    () => getCompletedTasksStorageKey(courseId, lessonId, pageId),
    [courseId, lessonId, pageId],
  );

  const [completedTaskIds, setCompletedTaskIds] = useState(() =>
    loadCompletedTaskIds(completedTasksStorageKey),
  );

  const currentTaskIdRef = useRef('');
  const autoTransitionTimerRef = useRef(null);
  const taskIndexRef = useRef(0);
  const tasksRef = useRef([]);

  useEffect(() => {
    return () => {
      if (autoTransitionTimerRef.current) {
        clearTimeout(autoTransitionTimerRef.current);
      }
    };
  }, []);


  useEffect(() => {
    setCompletedTaskIds(
      loadCompletedTaskIds(completedTasksStorageKey),
    );
  }, [completedTasksStorageKey]);

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

          /*
           * Chỉ đánh dấu Done khi backend xác nhận bài làm đúng hoàn toàn.
           * API trả về thành công nhưng isCorrect = false thì không cập nhật.
           */
            if (gradingResult?.isCorrect === true) {
              const payload = getFetchPayload(input, init);

              const submittedTaskId = String(
                payload?.taskId ||
                payload?.answer?.taskId ||
                currentTaskIdRef.current ||
                '',
              ).trim();

              if (submittedTaskId) {
                setCompletedTaskIds((currentIds) => {
                  if (currentIds.includes(submittedTaskId)) {
                    return currentIds;
                  }

                  const nextIds = [
                    ...currentIds,
                    submittedTaskId,
                  ];

                  localStorage.setItem(
                    completedTasksStorageKey,
                    JSON.stringify(nextIds),
                  );

                  return nextIds;
                });

                // Auto transition to the next task after 1.5 seconds
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
        }
      } catch (trackingError) {
        console.warn(
          'Could not update completed task indicator:',
          trackingError,
        );
      }

      return response;
    }

    window.fetch = trackedFetch;

    return () => {
      if (window.fetch === trackedFetch) {
        window.fetch = originalFetch;
      }
    };
  }, [completedTasksStorageKey]);

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

              finalPageInstance = applyManualActivityMapToPageInstance(
                nextPageInstance,
                activityMap,
              );
              finalManifest = applyManualActivityMapToManifest(
                nextManifest,
                activityMap,
              );
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

  const task = tasks[taskIndex] || null;
  const states = getStates(task);
  const state = states[stateIndex] || null;

  useEffect(() => {
    currentTaskIdRef.current = getTaskId(task);
  }, [task]);

  // Keep refs in sync for use inside closures (trackedFetch, setTimeout)
  taskIndexRef.current = taskIndex;
  tasksRef.current = tasks;

  const courseTitle = manifest?.metadata?.courseTitle || courseId || 'Course';
  const lessonTitle = manifest?.metadata?.lessonTitle || lessonId || 'Lesson';
  const pageTitle = manifest?.metadata?.pageTitle || pageId || 'Page';

  const frameConfig = useMemo(() => {
    return resolveFrameConfig(pageInstance, task, state);
  }, [pageInstance, task, state]);


  const currentRendererType = useMemo(() => {
    return resolveCurrentRendererType(task, state, pageInstance);
  }, [task, state, pageInstance]);

  const showSideArrows = currentRendererType === 'generic-static';

  const completedTaskCount = useMemo(() => {
    if (!tasks.length) return 0;

    const taskIdSet = new Set(
      tasks.map((item) => getTaskId(item)).filter(Boolean),
    );

    return completedTaskIds.filter((taskId) =>
      taskIdSet.has(String(taskId)),
    ).length;
  }, [completedTaskIds, tasks]);

  const lessonProgressPercent = useMemo(() => {
    if (!tasks.length) return 0;

    return Math.round(
      (completedTaskCount / tasks.length) * 100,
    );
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
    setTaskIndex(Math.min(tasks.length - 1, taskIndex + 1));
    setStateIndex(0);
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

  if (error) {
    return (
      <main className="empty-screen">
        <h1>Page failed to load</h1>
        <p>{error}</p>

        <button type="button" onClick={onBackToPages}>
          Back to pages
        </button>
      </main>
    );
  }

  if (!manifest || !pageInstance || !task || !state) {
    return (
      <main className="empty-screen">
        <p>Loading page...</p>

        <button type="button" onClick={onBackToPages}>
          Back to pages
        </button>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <TopNavigation
        title={pageTitle}
        courseId={courseId}
        courseTitle={courseTitle}
        moduleId={lessonId}
        lessonTitle={lessonTitle}
        pageId={pageId}
        pageTitle={pageTitle}
        tasks={tasks}
        currentTaskIndex={taskIndex}
        completedTaskIds={completedTaskIds}
        onSelectTask={gotoTask}
        onBackToCatalog={onBackToPages}
        onBackToCourses={onBackToLessons}
      />

      <ActivityRouter
        pageInstance={pageInstance}
        frameConfig={frameConfig}
        task={task}
        state={state}
        stateIndex={stateIndex}
        onNextTask={nextTask}
        onPrevTask={prevTask}
        onSelectState={setStateIndex}
        onBack={onBackToPages}
      />

    </div>
  );
}
