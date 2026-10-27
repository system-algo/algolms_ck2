import { useEffect, useMemo, useState } from 'react';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import { buildAuthenticatedActivityAttempt } from '../lib/ck2BackendAttempt.js';
import {
  loadLocalTaskState,
  saveLocalTaskState,
  resolveActivityMapUrl,
} from '../lib/taskExtractors.js';
import './SceneClassificationTask.css';

function getBackendBaseUrl() {
  return String(
    import.meta.env.VITE_API_BASE_URL ||
      import.meta.env.VITE_API_URL ||
      sessionStorage.getItem('lms_backend_url') ||
      localStorage.getItem('lms_backend_url') ||
      ''
  ).trim().replace(/\/+$/, '');
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
  } catch {}

  return {
    courseId: courseId || pageInstance?.courseId || pageInstance?.course?.id || pageInstance?.course || '',
    lessonId: lessonId || pageInstance?.lessonId || pageInstance?.lesson?.id || pageInstance?.lesson || '',
    pageId: pageId || pageInstance?.pageId || pageInstance?.page?.id || pageInstance?.id || '',
  };
}


function getConfigFromTask(task, pageInstance) {
  const taskId = getTaskId(task);
  return (
    task?.sceneClassification ||
    task?.scenesTask ||
    task?.scenes ||
    (taskId ? pageInstance?.taskRenderers?.[taskId]?.sceneClassification : null) ||
    null
  );
}

function areSceneSpritesCorrect(expected = [], actual = []) {
  if (expected.length !== actual.length) return false;
  const setActual = new Set(actual);
  return expected.every((id) => setActual.has(id));
}

export default function SceneClassificationTask({
  task,
  pageInstance,
  onPrevTask,
  onNextTask,
  onTaskCompleted,
  onTaskComplete,
  isTaskDone = false,
}) {
  const taskId = getTaskId(task);
  const storageKey = `scene-class-${task?.id || taskId}`;

  const [manualConfig, setManualConfig] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setManualConfig(null);

    const url = getManualMapUrl(pageInstance);
    if (!url || !taskId) return undefined;

    fetch(url)
      .then((response) => (response.ok ? response.json() : null))
      .then((manualMap) => {
        if (cancelled || !manualMap) return;
        const manualTask = manualMap?.tasks?.[taskId] || null;
        const nextConfig =
          manualTask?.sceneClassification ||
          manualTask?.scenesTask ||
          manualTask?.scenes ||
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

  const directConfig = getConfigFromTask(task, pageInstance);
  const config = manualConfig || directConfig || {};

  const title = config.title || task?.title || 'Part 1. My correct solution';
  const prompt = config.prompt || task?.prompt || 'What sprites are needed in each scene?';
  const attempt = config.attempt || 'Attempt: 1/2';

  const sprites = useMemo(() => {
    return Array.isArray(config.sprites) ? config.sprites : [];
  }, [config.sprites]);

  const scenes = useMemo(() => {
    return Array.isArray(config.scenes) ? config.scenes : [];
  }, [config.scenes]);

  const spriteMap = useMemo(() => {
    const map = new Map();
    sprites.forEach((s) => map.set(s.id, s));
    return map;
  }, [sprites]);

  // State: assignments is { [sceneId]: [spriteId1, spriteId2, ...] }
  const [assignments, setAssignments] = useState(() => {
    if (isTaskDone) {
      const full = {};
      scenes.forEach((sc) => {
        full[sc.id] = sc.expectedSprites || [];
      });
      return full;
    }
    const saved = loadLocalTaskState(storageKey, null);
    if (saved?.assignments && typeof saved.assignments === 'object') {
      return saved.assignments;
    }
    const initial = {};
    scenes.forEach((sc) => {
      initial[sc.id] = [];
    });
    return initial;
  });

  const [selectedSpriteId, setSelectedSpriteId] = useState('');
  const [hoveredSceneId, setHoveredSceneId] = useState(null);
  const [status, setStatus] = useState('');
  const [hasError, setHasError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [serverConfirmed, setServerConfirmed] = useState(false);

  // Sync state when isTaskDone or scenes change
  useEffect(() => {
    if (!scenes.length) return;

    if (isTaskDone) {
      const full = {};
      scenes.forEach((sc) => {
        full[sc.id] = sc.expectedSprites || [];
      });
      setAssignments(full);
      return;
    }

    const saved = loadLocalTaskState(storageKey, null);
    if (saved?.assignments && typeof saved.assignments === 'object') {
      setAssignments(saved.assignments);
      setStatus(saved?.status || '');
    } else {
      setAssignments((prev) => {
        const hasAny = Object.values(prev).some((arr) => Array.isArray(arr) && arr.length > 0);
        if (hasAny) return prev;
        const initial = {};
        scenes.forEach((sc) => {
          initial[sc.id] = [];
        });
        return initial;
      });
    }
  }, [isTaskDone, storageKey, scenes]);

  useEffect(() => {
    if (Object.keys(assignments).length > 0) {
      saveLocalTaskState(storageKey, {
        assignments,
        status,
      });
    }
  }, [storageKey, assignments, status]);

  function addSpriteToScene(sceneId, spriteId) {
    if (isSolved || checking || !sceneId || !spriteId) return;

    setAssignments((current) => {
      const existing = current[sceneId] || [];
      // If already in this scene, don't duplicate
      if (existing.includes(spriteId)) return current;

      return {
        ...current,
        [sceneId]: [...existing, spriteId],
      };
    });

    setSelectedSpriteId('');
    setStatus('');
    setHasError(false);
  }

  function removeSpriteFromScene(sceneId, spriteId) {
    if (isSolved || checking || !sceneId || !spriteId) return;

    setAssignments((current) => {
      const existing = current[sceneId] || [];
      return {
        ...current,
        [sceneId]: existing.filter((id) => id !== spriteId),
      };
    });

    setStatus('');
    setHasError(false);
  }

  function handleDrop(event, sceneId) {
    event.preventDefault();
    setHoveredSceneId(null);
    if (isSolved || checking) return;

    let spriteId = event.dataTransfer.getData('text/plain');
    if (!spriteId) {
      try {
        const parsed = JSON.parse(event.dataTransfer.getData('application/json'));
        spriteId = parsed?.spriteId || '';
      } catch {}
    }

    if (spriteId) {
      addSpriteToScene(sceneId, spriteId);
    }
  }

  function handleDragStart(event, spriteId) {
    if (isSolved || checking) return;
    event.dataTransfer.setData('text/plain', spriteId);
    event.dataTransfer.setData('application/json', JSON.stringify({ spriteId }));
    event.dataTransfer.effectAllowed = 'copy';
  }

  function handleSceneBoxClick(sceneId) {
    if (isSolved || checking) return;

    if (selectedSpriteId) {
      addSpriteToScene(sceneId, selectedSpriteId);
    }
  }

  function resetTask() {
    if (checking) return;
    const initial = {};
    scenes.forEach((sc) => {
      initial[sc.id] = [];
    });
    setAssignments(initial);
    setSelectedSpriteId('');
    setStatus('');
    setHasError(false);
  }

  async function submitAttemptToBackend(currentAssignments) {
    const apiBaseUrl = getBackendBaseUrl();
    if (!apiBaseUrl) throw new Error('LMS backend URL is not configured.');

    const { courseId, lessonId, pageId } = getRuntimeIds(pageInstance);
    const studentEmail =
      sessionStorage.getItem('lms_student_email') ||
      localStorage.getItem('lms_student_email') || '';
    const accessToken =
      sessionStorage.getItem('lms_access_token') ||
      localStorage.getItem('lms_access_token') || '';
    const effectiveTaskId = String(task?.id || task?.taskId || taskId || '').trim();
    const { headers, payload } = buildAuthenticatedActivityAttempt({
      studentEmail,
      accessToken,
      courseId: courseId || 'CK',
      lessonId,
      pageId,
      taskId: effectiveTaskId,
      activityType: 'scene-classification-task',
      answer: { assignments: currentAssignments },
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
    if (saved?.ok !== true || saved?.result?.isCorrect !== true) {
      throw new Error(
        `Backend did not grade the saved answer correct: ${saved?.result?.status || 'unknown'}`
      );
    }
    return saved;
  }

  function triggerSuccess(currentAssignments) {
    const effectiveTaskId = String(task?.id || task?.taskId || taskId || 'task-4').trim();

    window.dispatchEvent(
      new CustomEvent('LMS_TASK_COMPLETED', {
        detail: { taskId: effectiveTaskId },
      })
    );

    import('../utils/lmsSounds.js')
      .then(({ playLmsSound, LMS_SOUND_TYPES }) => {
        playLmsSound(LMS_SOUND_TYPES.COMPLETE_ACTIVITY);
      })
      .catch(() => {});

    const completionPayload = {
      taskId: effectiveTaskId,
      activityType: 'scene-classification-task',
      completionType: 'correct',
      isCorrect: true,
      score: 1,
      maxScore: 1,
      feedback: 'Correct!',
      metadata: { assignments: currentAssignments },
    };

    if (typeof onTaskCompleted === 'function') {
      onTaskCompleted(completionPayload);
    } else if (typeof onTaskComplete === 'function') {
      onTaskComplete(completionPayload);
    }

    const { courseId, lessonId, pageId } = getRuntimeIds(pageInstance);
    import('../lib/supabaseProgress.js')
      .then(({ saveTaskCompletionToSupabase }) => {
        if (typeof saveTaskCompletionToSupabase === 'function' && courseId && lessonId && pageId) {
          saveTaskCompletionToSupabase({
            courseId,
            lessonId,
            pageId,
            taskId: effectiveTaskId,
            isCompleted: true,
          }).catch(() => {});
        }
      })
      .catch(() => {});

    if (onNextTask) {
      setTimeout(onNextTask, 1200);
    }
  }

  async function checkTask() {
    if (checking) return;

    const totalPlaced = Object.values(assignments).reduce(
      (count, spriteIds) => count + (Array.isArray(spriteIds) ? spriteIds.length : 0), 0
    );
    if (totalPlaced === 0) {
      setStatus('Please place sprites into the scenes before checking.');
      setHasError(true);
      return;
    }

    const allScenesCorrect = scenes.length > 0 && scenes.every((scene) =>
      areSceneSpritesCorrect(scene.expectedSprites || [], assignments[scene.id] || [])
    );
    if (!allScenesCorrect) {
      setStatus('Almost there! Try again.');
      setHasError(true);
      return;
    }

    setChecking(true);
    setStatus('Saving your answer...');
    setHasError(false);
    try {
      await submitAttemptToBackend(assignments);
      setServerConfirmed(true);
      setStatus('Correct!');
      triggerSuccess(assignments);
    } catch (error) {
      console.warn('[SceneClassificationTask] CK2 attempt was not confirmed:', error);
      setStatus('Could not save or grade your answer. Please try again.');
      setHasError(true);
    } finally {
      setChecking(false);
    }
  }

  // Local scene placement does not mean the attempt was saved to the backend.
  const isSolved = Boolean(isTaskDone || serverConfirmed);

  return (
    <LmsActivityFrame
      title={title}
      status={status}
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
      onCheck={checkTask}
      onReset={resetTask}
      isCheckDisabled={checking}
      isResetDisabled={checking}
      isCheckLoading={checking}
      isTaskDone={isSolved}
    >
      <article className="scene-classification-task">
        {/* Header */}
        <header className="scene-classification-header">
          <div className="scene-classification-title-row">
            <h1 className={`scene-classification-title ${isSolved ? 'is-solved' : ''}`}>
              {isSolved && <span className="scene-classification-check-badge">✓</span>}
              {title}
            </h1>
            {attempt && <span className="scene-classification-attempt">{attempt}</span>}
          </div>
          <p className="scene-classification-instruction">{prompt}</p>
        </header>

        {/* Top Sprite Pool */}
        <section className="scene-classification-pool-wrapper" aria-label="Available Sprites">
          <div className="scene-classification-pool">
            {sprites.map((sprite) => {
              const isSelected = selectedSpriteId === sprite.id;

              return (
                <div
                  key={sprite.id}
                  className={`scene-classification-sprite-card ${isSelected ? 'is-selected' : ''}`}
                  draggable={!isSolved}
                  onDragStart={(e) => handleDragStart(e, sprite.id)}
                  onClick={() => {
                    if (isSolved) return;
                    setSelectedSpriteId((curr) => (curr === sprite.id ? '' : sprite.id));
                  }}
                  title={`Click or drag ${sprite.label}`}
                >
                  <img src={sprite.image} alt={sprite.label || ''} draggable={false} />
                </div>
              );
            })}
          </div>
        </section>

        {/* Horizontal Divider */}
        <hr className="scene-classification-divider" />

        {/* Bottom 4 Scene Columns */}
        <section className="scene-classification-scenes-grid" aria-label="Scenes">
          {scenes.map((scene) => {
            const placedSpriteIds = assignments[scene.id] || [];
            const isHovered = hoveredSceneId === scene.id;
            const isThisSceneCorrect = isSolved || areSceneSpritesCorrect(scene.expectedSprites || [], placedSpriteIds);

            return (
              <div key={scene.id} className="scene-classification-column">
                {/* Scene Header Image */}
                <div className="scene-classification-scene-preview">
                  <img
                    src={scene.image}
                    alt={scene.title || 'Scene preview'}
                    draggable={false}
                  />
                </div>

                {/* Scene Drop Box */}
                <div
                  className={[
                    'scene-classification-drop-box',
                    isSolved && isThisSceneCorrect ? 'is-solved' : '',
                    hasError && !isThisSceneCorrect ? 'is-error' : '',
                    isHovered ? 'is-hovered' : '',
                    selectedSpriteId ? 'can-drop' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => handleSceneBoxClick(scene.id)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setHoveredSceneId(scene.id);
                  }}
                  onDragLeave={() => setHoveredSceneId(null)}
                  onDrop={(e) => handleDrop(e, scene.id)}
                  title={selectedSpriteId ? `Click to place ${spriteMap.get(selectedSpriteId)?.label || 'sprite'}` : 'Drop sprites here'}
                >
                  {placedSpriteIds.length > 0 ? (
                    <div className="scene-classification-placed-grid">
                      {placedSpriteIds.map((spriteId) => {
                        const spriteObj = spriteMap.get(spriteId);
                        if (!spriteObj) return null;

                        return (
                          <div
                            key={spriteId}
                            className="scene-classification-placed-card"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeSpriteFromScene(scene.id, spriteId);
                            }}
                            title={`Click to remove ${spriteObj.label}`}
                          >
                            <img
                              src={spriteObj.image}
                              alt={spriteObj.label || ''}
                              draggable={false}
                            />
                            {!isSolved && (
                              <span className="scene-classification-remove-badge">×</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="scene-classification-drop-placeholder">
                      {selectedSpriteId ? 'Click to place here' : 'Drop sprites here'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      </article>
    </LmsActivityFrame>
  );
}
