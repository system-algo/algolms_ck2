import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import LmsActivityFrame from '../components/LmsActivityFrame.jsx';

function getTaskId(task) {
  return String(
    task?.id ||
      task?.taskId ||
      task?.taskKey ||
      task?.key ||
      '',
  ).trim();
}

const API_BASE_URL = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

function getRuntimeIds(pageInstance, task) {
  let courseId = '';
  let lessonId = '';
  let pageId = '';

  try {
    const params = new URLSearchParams(window.location.search);
    courseId = params.get('course') || params.get('courseId') || '';
    lessonId = params.get('lesson') || params.get('lessonId') || '';
    pageId = params.get('page') || params.get('pageId') || '';
  } catch {}

  return {
    courseId: courseId || task?.courseId || pageInstance?.courseId || '',
    lessonId: lessonId || task?.lessonId || pageInstance?.lessonId || '',
    pageId: pageId || task?.pageId || pageInstance?.pageId || '',
  };
}

function normalizeUserId(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function getActiveUserId(pageInstance, task) {
  try {
    const params = new URLSearchParams(
      window.location.search,
    );

    const fromUrl =
      params.get('studentEmail') ||
      params.get('userId') ||
      params.get('email') ||
      '';

    return normalizeUserId(
      task?.studentEmail ||
        task?.userId ||
        pageInstance?.studentEmail ||
        pageInstance?.userId ||
        fromUrl ||
        localStorage.getItem(
          'lms_student_email',
        ) ||
        localStorage.getItem(
          'lms-user-id',
        ) ||
        '',
    );
  } catch {
    return normalizeUserId(
      task?.studentEmail ||
        task?.userId ||
        pageInstance?.studentEmail ||
        pageInstance?.userId ||
        '',
    );
  }
}

function normalizeImages(task) {
  const data =
    task?.finishTask ||
    task?.finish_task ||
    {};

  const rawImages =
    Array.isArray(data.images) &&
    data.images.length > 0
      ? data.images
      : data.image
        ? [
            {
              src: data.image,
              alt:
                data.alt ||
                task?.title ||
                'Lesson image',
            },
          ]
        : [];

  return rawImages
    .map((item, index) => {
      if (typeof item === 'string') {
        return {
          src: item.trim(),
          alt: `Lesson image ${index + 1}`,
        };
      }

      return {
        src: String(
          item?.src ||
            item?.image ||
            item?.url ||
            '',
        ).trim(),
        alt:
          item?.alt ||
          `Lesson image ${index + 1}`,
      };
    })
    .filter((item) => item.src);
}

function createAllPageIndexes(imageCount) {
  return new Set(
    Array.from(
      { length: imageCount },
      (_, index) => index,
    ),
  );
}

export default function FinishTask({
  task,
  pageInstance,
  onTaskComplete,
  onTaskCompleted,
  onPrevTask,
  onNextTask,
  isTaskCompleted = false,
  isTaskDone = false,
  completedTaskIds,
}) {
  const taskId = getTaskId(task);
  const isAlreadyDone =
    isTaskCompleted ||
    isTaskDone ||
    (Array.isArray(completedTaskIds) && (completedTaskIds.includes(task?.id) || completedTaskIds.includes(taskId)));

  const completionHandler =
    typeof onTaskComplete === 'function'
      ? onTaskComplete
      : typeof onTaskCompleted === 'function'
        ? onTaskCompleted
        : null;

  const images = useMemo(
    () => normalizeImages(task),
    [task],
  );

  const studentEmail = getActiveUserId(
    pageInstance,
    task,
  );

  const imageSignature = useMemo(
    () =>
      images
        .map((image) => image.src)
        .join('|'),
    [images],
  );

  const [visitedImageIndexes, setVisitedImageIndexes] =
    useState(() => new Set());
  const [loadedImageIndexes, setLoadedImageIndexes] =
    useState(() => new Set());
  const [activeImageIndex, setActiveImageIndex] =
    useState(0);
  const [isCompleted, setIsCompleted] =
    useState(Boolean(isTaskCompleted));
  const [isSaving, setIsSaving] =
    useState(false);

  const completionSentRef = useRef(
    Boolean(isTaskCompleted),
  );
  const completionHandlerRef = useRef(
    completionHandler,
  );
  const imageRefs = useRef([]);
  const scrollContainerRef = useRef(null);

  useEffect(() => {
    completionHandlerRef.current =
      completionHandler;
  }, [completionHandler]);

  useEffect(() => {
    const alreadyCompleted =
      Boolean(isTaskCompleted);

    setVisitedImageIndexes(
      alreadyCompleted
        ? createAllPageIndexes(images.length)
        : new Set(),
    );
    setLoadedImageIndexes(new Set());
    setActiveImageIndex(0);
    setIsCompleted(alreadyCompleted);
    setIsSaving(false);

    completionSentRef.current =
      alreadyCompleted;
    imageRefs.current = [];

    const container =
      scrollContainerRef.current;

    if (container) {
      container.scrollTop = 0;
    }
  }, [
    taskId,
    imageSignature,
    images.length,
  ]);

  useEffect(() => {
    if (!isTaskCompleted) {
      return;
    }

    completionSentRef.current = true;
    setIsCompleted(true);
    setIsSaving(false);
    setVisitedImageIndexes(
      createAllPageIndexes(images.length),
    );
  }, [isTaskCompleted, images.length]);

  useEffect(() => {
    if (
      images.length !== 1 ||
      loadedImageIndexes.size !== 1 ||
      isTaskCompleted
    ) {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      setActiveImageIndex(0);
      setVisitedImageIndexes(
        (previousIndexes) => {
          if (previousIndexes.has(0)) {
            return previousIndexes;
          }

          const nextIndexes =
            new Set(previousIndexes);
          nextIndexes.add(0);

          console.log(
            '[FinishTask] single image viewed',
            { taskId },
          );

          return nextIndexes;
        },
      );
    }, 1200);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    images.length,
    loadedImageIndexes,
    isTaskCompleted,
    taskId,
  ]);

  useEffect(() => {
    const container =
      scrollContainerRef.current;

    if (!container || images.length <= 1) {
      return undefined;
    }

    function updateVisiblePage() {
      const containerRect =
        container.getBoundingClientRect();

      let bestIndex = 0;
      let bestVisibleHeight = 0;

      imageRefs.current.forEach(
        (element, index) => {
          if (!element) {
            return;
          }

          const elementRect =
            element.getBoundingClientRect();
          const visibleTop = Math.max(
            elementRect.top,
            containerRect.top,
          );
          const visibleBottom = Math.min(
            elementRect.bottom,
            containerRect.bottom,
          );
          const visibleHeight = Math.max(
            0,
            visibleBottom - visibleTop,
          );

          if (
            visibleHeight >
            bestVisibleHeight
          ) {
            bestVisibleHeight =
              visibleHeight;
            bestIndex = index;
          }
        },
      );

      setActiveImageIndex(bestIndex);

      const activeElement =
        imageRefs.current[bestIndex];

      if (!activeElement) {
        return;
      }

      const activeRect =
        activeElement.getBoundingClientRect();
      const requiredVisibleHeight =
        Math.min(
          activeRect.height * 0.35,
          containerRect.height * 0.35,
        );

      if (
        bestVisibleHeight <
        requiredVisibleHeight
      ) {
        return;
      }

      setVisitedImageIndexes(
        (previousIndexes) => {
          if (
            previousIndexes.has(
              bestIndex,
            )
          ) {
            return previousIndexes;
          }

          const nextIndexes =
            new Set(previousIndexes);
          nextIndexes.add(bestIndex);

          console.log(
            '[FinishTask] page viewed',
            {
              page: bestIndex + 1,
              total: images.length,
              viewedIndexes:
                Array.from(nextIndexes),
            },
          );

          return nextIndexes;
        },
      );
    }

    const frameId =
      window.requestAnimationFrame(
        updateVisiblePage,
      );

    container.addEventListener(
      'scroll',
      updateVisiblePage,
      { passive: true },
    );
    window.addEventListener(
      'resize',
      updateVisiblePage,
    );

    return () => {
      window.cancelAnimationFrame(
        frameId,
      );
      container.removeEventListener(
        'scroll',
        updateVisiblePage,
      );
      window.removeEventListener(
        'resize',
        updateVisiblePage,
      );
    };
  }, [
    images.length,
    taskId,
    imageSignature,
  ]);

  const hasViewedAllImages =
    images.length > 0 &&
    visitedImageIndexes.size >=
      images.length;

  useEffect(() => {
    if (
      !hasViewedAllImages ||
      completionSentRef.current ||
      isTaskCompleted ||
      isTaskDone
    ) {
      return undefined;
    }

    const completionTimer =
      window.setTimeout(
        async () => {
          if (
            completionSentRef.current
          ) {
            return;
          }

          completionSentRef.current = true;
          setIsSaving(true);

          const viewedPageIndexes =
            Array.from(
              visitedImageIndexes,
            ).sort(
              (indexA, indexB) =>
                indexA - indexB,
            );

          try {
            const { courseId: currentCourseId, lessonId: currentLessonId, pageId: currentPageId } = getRuntimeIds(pageInstance, task);
            const sessionId = localStorage.getItem('algolms_session_id') || localStorage.getItem('lms-session-id') || `session-${Date.now()}`;
            
            if (API_BASE_URL && taskId && currentPageId) {
              const res = await fetch(`${API_BASE_URL}/api/activity-completions`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  sessionId,
                  userId: studentEmail || null,
                  courseId: currentCourseId,
                  lessonId: currentLessonId,
                  pageId: currentPageId,
                  taskId: taskId,
                  activityType: 'finish-task',
                  isCorrect: true,
                  score: 1,
                  maxScore: 1
                })
              });
              if (!res.ok) {
                console.error('Backend activity completion failed for FinishTask:', await res.text());
              }
            }

            if (typeof handler === 'function') {
              const result = await handler({
                taskId,
                studentEmail:
                  studentEmail || null,
                userId:
                  studentEmail || null,
                activityType:
                  'finish-task',
                completionType:
                  'viewed-all-images',
                status: 'completed',
                isCorrect: true,
                score: 1,
                maxScore: 1,
                feedback:
                  'All pages viewed.',
                metadata: {
                  totalPages:
                    images.length,
                  viewedPages:
                    viewedPageIndexes.length,
                  viewedPageIndexes,
                  studentEmail:
                    studentEmail || null,
                },
              });

              console.log(
                '[FinishTask] completion saved',
                result,
              );
            }

            import('../utils/lmsSounds.js')
              .then(({ playLmsSound, LMS_SOUND_TYPES }) => {
                playLmsSound(LMS_SOUND_TYPES.COMPLETE_ACTIVITY);
              })
              .catch(() => {});

            window.dispatchEvent(
              new CustomEvent('LMS_TASK_COMPLETED', {
                detail: { taskId: task?.id || taskId },
              })
            );

            setIsCompleted(true);
          } catch (error) {
            console.error(
              '[FinishTask] failed to save progress.',
              error,
            );
            completionSentRef.current =
              false;
            setIsCompleted(false);
          } finally {
            setIsSaving(false);
          }
        },
        5000,
      );

    return () => {
      window.clearTimeout(
        completionTimer,
      );
    };
  }, [
    hasViewedAllImages,
    images.length,
    isTaskCompleted,
    studentEmail,
    taskId,
    visitedImageIndexes,
  ]);

  function scrollToImage(index) {
    const container =
      scrollContainerRef.current;
    const target =
      imageRefs.current[index];

    if (!container || !target) {
      return;
    }

    container.scrollTo({
      top: target.offsetTop,
      behavior: 'smooth',
    });
  }

  const currentPage =
    images.length > 0
      ? Math.min(
          activeImageIndex + 1,
          images.length,
        )
      : 0;

  const statusText = isCompleted
    ? 'Viewed.'
    : isSaving
      ? 'Saving progress...'
      : `${visitedImageIndexes.size}/${images.length} viewed`;

  function handleCheck() {
    if (!isAlreadyDone && !isCompleted) {
      import('../utils/lmsSounds.js')
        .then(({ playLmsSound, LMS_SOUND_TYPES }) => {
          playLmsSound(LMS_SOUND_TYPES.COMPLETE_ACTIVITY);
        })
        .catch(() => {});

      window.dispatchEvent(
        new CustomEvent('LMS_TASK_COMPLETED', {
          detail: { taskId: task?.id || taskId },
        })
      );
    }

    if (onNextTask) {
      onNextTask();
    }
  }

  function handleReset() {
    scrollToImage(0);
  }

  if (images.length === 0) {
    return (
      <LmsActivityFrame
        title={task?.title || 'Activity'}
        onPrevTask={onPrevTask}
        onNextTask={onNextTask}
        onCheck={handleCheck}
        onReset={handleReset}
        status="No image available."
        isTaskDone={isTaskDone}
      >
        <div
          style={{
            width: '100%',
            minHeight:
              'calc(100vh - 260px)',
            display: 'grid',
            placeItems: 'center',
            borderRadius: 16,
            background: '#eef2f6',
            color: '#64748b',
            fontSize: 18,
            fontWeight: 700,
            boxSizing: 'border-box',
          }}
        >
          No image available.
        </div>
      </LmsActivityFrame>
    );
  }

  return (
    <LmsActivityFrame
      title={task?.title || 'Activity'}
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
      onCheck={handleCheck}
      onReset={handleReset}
      status={statusText}
      isTaskDone={isTaskDone || isCompleted}
    >
      <div
        style={{
          width: '100%',
          minHeight:
            'calc(100vh - 250px)',
          position: 'relative',
          padding: '20px 24px 82px',
          borderRadius: 16,
          background: '#eef2f6',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        <div
          ref={scrollContainerRef}
          style={{
            width:
              'min(1300px, 100%)',
            height:
              'calc(100vh - 300px)',
            minHeight: 420,
            margin: '0 auto',
            paddingRight: 6,
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            overflowX: 'hidden',
            overflowY:
              images.length > 1
                ? 'auto'
                : 'hidden',
            scrollBehavior: 'smooth',
            scrollSnapType:
              images.length > 1
                ? 'y mandatory'
                : 'none',
            boxSizing: 'border-box',
          }}
        >
          {images.map(
            (image, index) => {
              const finishTaskConfig = task?.finishTask || task?.finish_task || {};
              const targetLinkUrl =
                image?.linkUrl ||
                image?.url ||
                image?.href ||
                finishTaskConfig.linkUrl ||
                finishTaskConfig.url ||
                finishTaskConfig.href ||
                task?.linkUrl ||
                task?.url ||
                task?.href ||
                (String(image.src).includes('task-4-5hxbkt') ? 'https://www.youtube.com' : '');

              return (
                <div
                  key={`${image.src}-${index}`}
                  ref={(element) => {
                    imageRefs.current[index] = element;
                  }}
                  data-index={index}
                  onClick={() => {
                    if (targetLinkUrl) {
                      window.open(targetLinkUrl, '_blank', 'noopener,noreferrer');
                      handleCheck();
                    }
                  }}
                  title={targetLinkUrl ? `Click to open site: ${targetLinkUrl}` : undefined}
                  style={{
                    width: '100%',
                    minHeight: 'calc(100vh - 310px)',
                    flexShrink: 0,
                    padding: 12,
                    borderRadius: 12,
                    background: '#ffffff',
                    boxShadow: '0 10px 30px rgba(15, 23, 42, 0.1)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                    scrollSnapAlign: 'start',
                    scrollSnapStop: 'always',
                    cursor: targetLinkUrl ? 'pointer' : 'default',
                  }}
                >
                  <img
                    src={image.src}
                    alt={image.alt}
                    draggable={false}
                    onLoad={() => {
                      setLoadedImageIndexes((previousIndexes) => {
                        if (previousIndexes.has(index)) {
                          return previousIndexes;
                        }
                        const nextIndexes = new Set(previousIndexes);
                        nextIndexes.add(index);
                        return nextIndexes;
                      });
                    }}
                    onError={(event) => {
                      console.error('[FinishTask] Image failed to load:', image.src);
                      event.currentTarget.style.opacity = '0.35';
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      maxWidth: '100%',
                      height: 'auto',
                      maxHeight: 'calc(100vh - 340px)',
                      objectFit: 'contain',
                      objectPosition: 'center center',
                      userSelect: 'none',
                      pointerEvents: targetLinkUrl ? 'auto' : 'none',
                    }}
                  />
                </div>
              );
            },
          )}
        </div>

        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 18,
            transform:
              'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minHeight: 38,
            padding: '7px 14px',
            border:
              '1px solid rgba(137, 67, 239, 0.16)',
            borderRadius: 999,
            background: '#ffffff',
            color: '#475569',
            boxShadow:
              '0 7px 18px rgba(15, 23, 42, 0.12)',
            fontSize: 13,
            fontWeight: 800,
            whiteSpace: 'nowrap',
            zIndex: 10,
          }}
        >
          <span>
            {currentPage} / {images.length}
          </span>

          {images.length > 1 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {images.map(
                (image, index) => {
                  const isActive =
                    index ===
                    activeImageIndex;
                  const hasVisited =
                    visitedImageIndexes.has(
                      index,
                    );

                  return (
                    <button
                      key={`${image.src}-indicator-${index}`}
                      type="button"
                      onClick={() =>
                        scrollToImage(index)
                      }
                      aria-label={`Show page ${index + 1}`}
                      aria-current={
                        isActive
                          ? 'page'
                          : undefined
                      }
                      style={{
                        width: isActive
                          ? 20
                          : 8,
                        height: 8,
                        padding: 0,
                        border: 0,
                        borderRadius: 999,
                        background:
                          isActive
                            ? '#8943ef'
                            : hasVisited
                              ? '#c9a8f6'
                              : '#d7dee8',
                        cursor: 'pointer',
                        transition:
                          'width 150ms ease, background 150ms ease',
                      }}
                    />
                  );
                },
              )}
            </div>
          ) : null}

          <span
            style={{
              paddingLeft: 10,
              borderLeft:
                '1px solid #e2e8f0',
              color: isCompleted
                ? '#15803d'
                : isSaving
                  ? '#b45309'
                  : '#7c3aed',
              fontWeight: 900,
            }}
          >
            {isCompleted
              ? 'Viewed ✓'
              : isSaving
                ? 'Saving…'
                : `${visitedImageIndexes.size}/${images.length} viewed`}
          </span>
        </div>
      </div>
    </LmsActivityFrame>
  );
}