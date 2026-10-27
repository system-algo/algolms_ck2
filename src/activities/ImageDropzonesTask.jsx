import { useEffect, useMemo, useState } from 'react';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import {
  loadLocalTaskState,
  saveLocalTaskState,
  resolveActivityMapUrl,
} from '../lib/taskExtractors.js';
import './ImageDropzonesTask.css';

const API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  localStorage.getItem('lms_backend_url') ||
  sessionStorage.getItem('lms_backend_url') ||
  ''
).replace(/\/+$/, '');

const SESSION_STORAGE_KEY = 'algolms_session_id';

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

function getSessionId() {
  try {
    const params = new URLSearchParams(window.location.search);
    const qSession = params.get('sessionId') || params.get('session');
    if (qSession) return qSession;

    const existing = localStorage.getItem(SESSION_STORAGE_KEY) || localStorage.getItem('lms-session-id');
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

function getUserId() {
  try {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get('userId') ||
      params.get('studentEmail') ||
      params.get('email') ||
      localStorage.getItem('lms_student_email') ||
      sessionStorage.getItem('lms_student_email') ||
      'student@algo.edu.vn'
    );
  } catch {
    return 'student@algo.edu.vn';
  }
}

function getImageSrc(image) {
  if (!image) return '';
  if (typeof image === 'string') return image;

  return (
    image.imageSrc ||
    image.localSrc ||
    image.publicSrc ||
    image.src ||
    image.url ||
    image.href ||
    ''
  );
}

function normalizeImage(image) {
  const src = getImageSrc(image);
  if (!src) return null;

  if (typeof image === 'string') {
    return {
      src,
      alt: '',
      width: 0,
      height: 0,
    };
  }

  return {
    ...image,
    src,
    alt: image.alt || image.label || image.title || '',
    width: image.naturalWidth || image.width || image.rect?.w || 0,
    height: image.naturalHeight || image.height || image.rect?.h || 0,
  };
}

function normalizeDraggable(item, index) {
  if (typeof item === 'string') {
    return {
      id: normalizeKey(item) || `item-${index + 1}`,
      label: item,
      imageSrc: '',
    };
  }

  const label =
    item?.label ||
    item?.text ||
    item?.title ||
    item?.name ||
    item?.value ||
    `Item ${index + 1}`;

  return {
    ...item,
    id: item?.id || item?.key || normalizeKey(label) || `item-${index + 1}`,
    label,
    imageSrc:
      item?.imageSrc ||
      item?.image ||
      item?.src ||
      item?.url ||
      item?.href ||
      '',
  };
}

function normalizeDraggables(values = []) {
  return values.map(normalizeDraggable).filter((item) => item.id && (item.label || item.imageSrc));
}

function normalizeDropzone(zone, index) {
  const label =
    zone?.label ||
    zone?.title ||
    zone?.name ||
    zone?.text ||
    `Dropzone ${index + 1}`;

  const accepts = Array.isArray(zone?.accepts)
    ? zone.accepts
    : [zone?.accepts || zone?.answer || zone?.itemId || zone?.correctItemId || ''];

  const id = String(zone?.id || zone?.key || `zone-${index + 1}`).trim();
  const acceptsList = accepts.filter(Boolean).map(String);

  const x = Number(zone?.x ?? zone?.left ?? 0);
  const y = Number(zone?.y ?? zone?.top ?? 0);
  const w = Number(zone?.w ?? zone?.width ?? 20);
  const h = Number(zone?.h ?? zone?.height ?? 10);

  return {
    ...zone,
    id,
    label,
    accepts: acceptsList,
    x,
    y,
    w,
    h,
  };
}

function normalizeDropzones(values = []) {
  return values.map(normalizeDropzone).filter((zone) => zone.id);
}

function getConfigFromTask(task, pageInstance) {
  const taskId = getTaskId(task);
  return (
    task?.imageDropzones ||
    task?.imageAssembly ||
    task?.diagramDropzones ||
    (taskId ? pageInstance?.taskRenderers?.[taskId]?.imageDropzones : null) ||
    (taskId ? pageInstance?.taskRenderers?.[taskId]?.imageAssembly : null) ||
    (task?.matchingDragdrop?.mode === 'image-drop' ? task.matchingDragdrop : null) ||
    null
  );
}

function buildData(task, config = {}) {
  const safeConfig = config || {};

  const title =
    safeConfig.title ||
    safeConfig.prompt ||
    task?.title ||
    'Part 1. My correct solution';

  const prompt =
    safeConfig.prompt ||
    safeConfig.question ||
    task?.question ||
    'Put together according to the sample';

  const draggables = normalizeDraggables(
    safeConfig.draggables ||
    safeConfig.items ||
    safeConfig.choices ||
    [],
  );

  const dropzones = normalizeDropzones(
    safeConfig.dropzones ||
    safeConfig.zones ||
    safeConfig.targets ||
    [],
  );

  const sampleImage = getImageSrc(
    safeConfig.sampleImage ||
    safeConfig.sample ||
    safeConfig.templateImage ||
    safeConfig.referenceImage ||
    ''
  );

  const backgroundImage = normalizeImage(
    safeConfig.backgroundImage ||
    safeConfig.background ||
    safeConfig.image ||
    safeConfig.src ||
    ''
  );

  const isAssembly = Boolean(
    sampleImage ||
    safeConfig.layout === 'assembly' ||
    safeConfig.variant === 'assembly'
  );

  return {
    title,
    prompt,
    helperText: safeConfig.helperText || '',
    attempt: safeConfig.attempt || 'Attempt: 1/2',
    sampleImage,
    backgroundImage,
    draggables,
    dropzones,
    isAssembly,
    variant: safeConfig.variant || (isAssembly ? 'assembly' : ''),
  };
}

function isPlacementCorrect(zone, itemId) {
  if (!itemId) return false;
  return zone.accepts.includes(itemId);
}

function getInitialPlacements(dropzones) {
  return dropzones.reduce((acc, zone) => {
    acc[zone.id] = '';
    return acc;
  }, {});
}

function removeItemFromPlacements(placements, itemId) {
  const next = { ...placements };
  Object.entries(next).forEach(([zoneId, value]) => {
    if (value === itemId) {
      next[zoneId] = '';
    }
  });
  return next;
}

function renderItemContent(item, imageClassName) {
  if (!item) return null;

  if (item.imageSrc) {
    return (
      <img
        className={imageClassName}
        src={item.imageSrc}
        alt={item.label || ''}
        draggable={false}
      />
    );
  }

  return item.label;
}

function sanitizePlacements(rawPlacements, dropzones, draggables) {
  const initial = getInitialPlacements(dropzones);
  if (!rawPlacements || typeof rawPlacements !== 'object') return initial;

  const validZoneIds = new Set(dropzones.map((z) => z.id));
  const validItemIds = new Set(draggables.map((d) => d.id));

  const result = { ...initial };
  Object.entries(rawPlacements).forEach(([zoneId, itemId]) => {
    if (validZoneIds.has(zoneId) && validItemIds.has(itemId)) {
      result[zoneId] = itemId;
    }
  });

  return result;
}

export default function ImageDropzonesTask({
  task,
  pageInstance,
  onPrevTask,
  onNextTask,
  onTaskCompleted,
  onTaskComplete,
  isTaskDone = false,
}) {
  const taskId = getTaskId(task);
  const storageKey = `img-drop-${task?.id || taskId}`;

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
          manualTask?.imageDropzones ||
          manualTask?.imageAssembly ||
          manualTask?.diagramDropzones ||
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

  const data = useMemo(() => buildData(task, config), [task, config]);

  const [selectedItemId, setSelectedItemId] = useState('');
  const [hoveredZoneId, setHoveredZoneId] = useState(null);
  const [status, setStatus] = useState('');
  const [hasError, setHasError] = useState(false);
  const [checking, setChecking] = useState(false);

  // Placements state
  const [placements, setPlacements] = useState(() => {
    if (isTaskDone) {
      const full = {};
      data.dropzones.forEach((zone) => {
        full[zone.id] = zone.accepts[0] || '';
      });
      return full;
    }
    const saved = loadLocalTaskState(storageKey, null);
    return sanitizePlacements(saved?.placements, data.dropzones, data.draggables);
  });

  // Sync state when data or isTaskDone changes
  useEffect(() => {
    if (!data.dropzones.length) return;

    if (isTaskDone) {
      const full = {};
      data.dropzones.forEach((zone) => {
        full[zone.id] = zone.accepts[0] || '';
      });
      setPlacements(full);
      return;
    }

    const saved = loadLocalTaskState(storageKey, null);
    if (saved?.placements) {
      setPlacements(sanitizePlacements(saved.placements, data.dropzones, data.draggables));
      setStatus(saved?.status || '');
    } else {
      setPlacements((prev) => {
        const hasAny = Object.values(prev).some(Boolean);
        return hasAny ? prev : getInitialPlacements(data.dropzones);
      });
    }
  }, [isTaskDone, storageKey, data.dropzones, data.draggables]);

  useEffect(() => {
    if (Object.keys(placements).length > 0) {
      saveLocalTaskState(storageKey, {
        placements,
        status,
      });
    }
  }, [storageKey, placements, status]);

  const placedItemIds = useMemo(
    () => new Set(Object.values(placements).filter(Boolean)),
    [placements],
  );

  const availableItems = useMemo(
    () => data.draggables.filter((item) => !placedItemIds.has(item.id)),
    [data.draggables, placedItemIds],
  );

  function getItemById(itemId) {
    return data.draggables.find((item) => item.id === itemId) || null;
  }

  function placeItem(zoneId, itemId) {
    if (!zoneId || !itemId || checking || isSolved) return;

    setPlacements((current) => {
      const withoutItem = removeItemFromPlacements(current, itemId);
      return {
        ...withoutItem,
        [zoneId]: itemId,
      };
    });

    setSelectedItemId('');
    setStatus('');
    setHasError(false);
  }

  function clearZone(zoneId) {
    if (checking || isSolved) return;

    setPlacements((current) => ({
      ...current,
      [zoneId]: '',
    }));
    setStatus('');
    setHasError(false);
  }

  function handleDrop(event, zoneId) {
    event.preventDefault();
    setHoveredZoneId(null);
    if (checking || isSolved) return;

    let itemId = event.dataTransfer.getData('text/plain');
    if (!itemId) {
      try {
        const parsed = JSON.parse(event.dataTransfer.getData('application/json'));
        itemId = parsed?.itemId || '';
      } catch {}
    }

    if (itemId) {
      placeItem(zoneId, itemId);
    }
  }

  function handleDragStart(event, itemId, source = 'tray', fromZoneId = null) {
    if (checking || isSolved) return;
    event.dataTransfer.setData('text/plain', itemId);
    event.dataTransfer.setData('application/json', JSON.stringify({ itemId, source, fromZoneId }));
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleZoneClick(zoneId) {
    if (isSolved || checking) return;

    if (selectedItemId) {
      placeItem(zoneId, selectedItemId);
    } else {
      const existingItemId = placements[zoneId];
      if (existingItemId) {
        clearZone(zoneId);
      }
    }
  }

  function resetTask() {
    if (checking) return;
    setPlacements(getInitialPlacements(data.dropzones));
    setSelectedItemId('');
    setStatus('');
    setHasError(false);
  }

  async function submitAttemptToBackend(currentPlacements) {
    if (!API_BASE_URL) return null;

    const { courseId, lessonId, pageId } = getRuntimeIds(pageInstance);
    const effectiveTaskId = String(task?.id || task?.taskId || taskId || 'task-3').trim();
    if (!courseId || !lessonId || !pageId || !effectiveTaskId) return null;

    try {
      const response = await fetch(`${API_BASE_URL}/api/activity-attempts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: getSessionId(),
          userId: getUserId(),
          courseId,
          lessonId,
          pageId,
          taskId: effectiveTaskId,
          activityType: 'image-dropzones-task',
          answer: { placements: currentPlacements },
          isCorrect: true,
          score: 1,
          maxScore: 1,
        }),
      });

      return response.ok ? await response.json().catch(() => null) : null;
    } catch {
      return null;
    }
  }

  function triggerSuccess(currentPlacements) {
    const effectiveTaskId = String(task?.id || task?.taskId || taskId || 'task-3').trim();

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
      activityType: 'image-dropzones-task',
      completionType: 'correct',
      isCorrect: true,
      score: 1,
      maxScore: 1,
      feedback: 'Correct!',
      metadata: { placements: currentPlacements },
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

  function checkTask() {
    if (checking) return;

    const filledCount = data.dropzones.filter((zone) => Boolean(placements[zone.id])).length;
    if (filledCount < data.dropzones.length) {
      setStatus(`Please place all pieces onto the picture first (${filledCount}/${data.dropzones.length})`);
      setHasError(true);
      return;
    }

    setChecking(true);

    const allCorrect = data.dropzones.every((zone) => {
      const itemId = placements[zone.id];
      return isPlacementCorrect(zone, itemId);
    });

    if (allCorrect) {
      setStatus('Correct!');
      setHasError(false);
      triggerSuccess(placements);
      submitAttemptToBackend(placements);
    } else {
      setStatus('Almost there! Try again.');
      setHasError(true);
    }

    setChecking(false);
  }

  const isSolved = Boolean(
    isTaskDone ||
    (data.dropzones.length > 0 &&
      data.dropzones.every((zone) => isPlacementCorrect(zone, placements[zone.id])))
  );

  return (
    <LmsActivityFrame
      title={data.title}
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
      {data.isAssembly ? (
        /* Image Assembly Puzzle Mode */
        <article className="image-assembly-task">
          {/* Header */}
          <header className="image-assembly-header">
            <div className="image-assembly-title-row">
              <h1 className={`image-assembly-title ${isSolved ? 'is-solved' : ''}`}>
                {isSolved && (
                  <span className="image-assembly-check-badge">✓</span>
                )}
                {data.title}
              </h1>
              {data.attempt && (
                <span className="image-assembly-attempt">{data.attempt}</span>
              )}
            </div>
            <p className="image-assembly-instruction">{data.prompt}</p>
          </header>

          {/* Sample Target Image */}
          {data.sampleImage && (
            <div className="image-assembly-sample-container">
              <img
                className="image-assembly-sample-img"
                src={data.sampleImage}
                alt="Sample target"
                draggable={false}
              />
            </div>
          )}

          {/* Working Canvas with Background and Dropzones */}
          <div
            className={`image-assembly-canvas-wrapper ${isSolved ? 'is-solved' : ''} ${hasError ? 'is-error' : ''}`}
          >
            {data.backgroundImage?.src ? (
              <div
                className="image-assembly-canvas"
                onDragOver={(e) => e.preventDefault()}
              >
                <img
                  className="image-assembly-bg-img"
                  src={data.backgroundImage.src}
                  alt={data.backgroundImage.alt || ''}
                  draggable={false}
                />

                {/* Dropzones overlaid on canvas */}
                {data.dropzones.map((zone) => {
                  const placedItem = getItemById(placements[zone.id]);
                  const isHovered = hoveredZoneId === zone.id;

                  return (
                    <div
                      key={zone.id}
                      className={[
                        'image-assembly-zone',
                        placedItem ? 'has-item' : 'is-empty',
                        selectedItemId ? 'is-ready' : '',
                        isHovered ? 'is-hovered' : '',
                      ].filter(Boolean).join(' ')}
                      style={{
                        left: `${zone.x}%`,
                        top: `${zone.y}%`,
                        width: `${zone.w}%`,
                        height: `${zone.h}%`,
                      }}
                      onClick={() => handleZoneClick(zone.id)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setHoveredZoneId(zone.id);
                      }}
                      onDragLeave={() => setHoveredZoneId(null)}
                      onDrop={(e) => handleDrop(e, zone.id)}
                      title={placedItem ? `Click to remove ${placedItem.label}` : zone.label}
                    >
                      {placedItem ? (
                        <div
                          className="image-assembly-placed-item"
                          draggable={!isSolved}
                          onDragStart={(e) => handleDragStart(e, placedItem.id, 'zone', zone.id)}
                          onClick={(e) => {
                            e.stopPropagation();
                            clearZone(zone.id);
                          }}
                        >
                          <img
                            src={placedItem.imageSrc}
                            alt={placedItem.label || ''}
                            draggable={false}
                          />
                          {!isSolved && (
                            <span
                              className="image-assembly-remove-btn"
                              title="Remove"
                            >
                              ×
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="image-assembly-placeholder" />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="image-dropzones-no-image">No background image found.</div>
            )}
          </div>

          {/* Draggable Sprites Tray */}
          <div className="image-assembly-tray-wrapper">
            <div className="image-assembly-tray">
              {data.draggables.map((item) => {
                const isPlaced = placedItemIds.has(item.id);
                const isSelected = selectedItemId === item.id;

                return (
                  <div
                    key={item.id}
                    className={[
                      'image-assembly-tray-card',
                      isPlaced ? 'is-placed' : 'is-available',
                      isSelected ? 'is-selected' : '',
                    ].filter(Boolean).join(' ')}
                    draggable={!isPlaced && !isSolved}
                    onDragStart={(e) => handleDragStart(e, item.id, 'tray')}
                    onClick={() => {
                      if (isSolved || isPlaced) return;
                      setSelectedItemId((curr) => (curr === item.id ? '' : item.id));
                    }}
                    title={isPlaced ? `${item.label} (already placed)` : `Click or drag ${item.label}`}
                  >
                    <div className="image-assembly-tray-img-box">
                      <img src={item.imageSrc} alt={item.label || ''} draggable={false} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </article>
      ) : (
        /* Legacy Diagram Labeling Mode */
        <article className={`image-dropzones-task ${data.variant ? `is-${data.variant}` : ''}`}>
          <section className="image-dropzones-card">
            <h1 className="image-dropzones-title">{data.prompt}</h1>
            {data.helperText && <p className="image-dropzones-helper">{data.helperText}</p>}

            <div className="image-dropzones-layout">
              <aside className="image-dropzones-sidebar">
                {availableItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`image-dropzones-draggable${
                      selectedItemId === item.id ? ' is-selected' : ''
                    }${item.imageSrc ? ' has-image' : ''}`}
                    draggable={!checking}
                    disabled={checking}
                    onClick={() => {
                      if (checking) return;
                      setSelectedItemId((current) => (current === item.id ? '' : item.id));
                    }}
                    onDragStart={(event) => handleDragStart(event, item.id)}
                    title={item.label}
                  >
                    {renderItemContent(item, 'image-dropzones-draggable-image')}
                  </button>
                ))}

                {!availableItems.length && (
                  <div className="image-dropzones-empty">All answers placed</div>
                )}
              </aside>

              <div className="image-dropzones-image-area">
                {data.backgroundImage?.src ? (
                  <div className="image-dropzones-image-shell">
                    <img
                      className="image-dropzones-image"
                      src={data.backgroundImage.src}
                      alt={data.backgroundImage.alt || ''}
                      draggable={false}
                    />

                    {data.dropzones.map((zone) => {
                      const placedItem = getItemById(placements[zone.id]);

                      return (
                        <button
                          key={zone.id}
                          type="button"
                          className={[
                            'image-dropzones-zone',
                            placedItem ? 'has-item' : '',
                            placedItem?.imageSrc ? 'has-image-item' : '',
                            selectedItemId ? 'is-ready' : '',
                          ].filter(Boolean).join(' ')}
                          style={{
                            left: `${zone.x}%`,
                            top: `${zone.y}%`,
                            width: `${zone.w}%`,
                            height: `${zone.h}%`,
                          }}
                          onClick={() => handleZoneClick(zone.id)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => handleDrop(event, zone.id)}
                          disabled={checking}
                        >
                          {placedItem ? (
                            <span
                              className="image-dropzones-placed"
                              draggable={!checking}
                              onDragStart={(event) => handleDragStart(event, placedItem.id)}
                            >
                              {renderItemContent(placedItem, 'image-dropzones-placed-image')}
                            </span>
                          ) : (
                            <span className="image-dropzones-zone-placeholder">Drop here</span>
                          )}

                          {placedItem && (
                            <span
                              role="button"
                              tabIndex={0}
                              className="image-dropzones-clear"
                              onClick={(event) => {
                                event.stopPropagation();
                                clearZone(zone.id);
                              }}
                            >
                              ×
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="image-dropzones-no-image">No background image found.</div>
                )}
              </div>
            </div>
          </section>
        </article>
      )}
    </LmsActivityFrame>
  );
}
