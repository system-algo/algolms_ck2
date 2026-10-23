import { useEffect } from 'react';
import './LessonFinishTask.css';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import { cleanTextLines } from '../lib/taskExtractors.js';

export default function LessonFinishTask({
  task,
  state,
  onPrevTask,
  onNextTask,
  onBackToCatalog,
}) {
  const lines = cleanTextLines(state?.textLines || []);
  const title = lines[0] || task?.title || 'Way to go! You finished the task!';

  useEffect(() => {
    // 5 seconds delay after page appears before showing progress popup & playing sound
    const timer = setTimeout(() => {
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
    }, 5000);

    return () => clearTimeout(timer);
  }, [task?.id, task?.taskId]);

  const handleBackToProfile = () => {
    const currentLesson =
      task?.lessonId ||
      state?.lessonId ||
      (() => {
        try {
          return new URLSearchParams(window.location.search).get('lesson') || '';
        } catch {
          return '';
        }
      })();
    if (typeof onBackToCatalog === 'function') {
      onBackToCatalog(currentLesson);
    } else if (typeof onNextTask === 'function') {
      onNextTask();
    }
  };

  const courseId =
    task?.courseId ||
    state?.courseId ||
    (() => {
      try {
        return new URLSearchParams(window.location.search).get('course') || localStorage.getItem('lms_current_course_id') || 'GD';
      } catch {
        return 'GD';
      }
    })();
  const lessonId =
    task?.lessonId ||
    state?.lessonId ||
    (() => {
      try {
        return new URLSearchParams(window.location.search).get('lesson') || localStorage.getItem('lms_current_lesson_id') || '';
      } catch {
        return '';
      }
    })();
  const pageId =
    task?.pageId ||
    state?.pageId ||
    (() => {
      try {
        return new URLSearchParams(window.location.search).get('page') || localStorage.getItem('lms_current_page_id') || '';
      } catch {
        return '';
      }
    })();

  const finishImageSrc =
    courseId && lessonId && pageId
      ? `/courses/${courseId}/${lessonId}/pages/${pageId}/assets/way-to-go.png`
      : `/courses/${courseId}/assets/finish/way-to-go.png`;

  return (
    <LmsActivityFrame
      title={title}
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
    >
      <article className="functional-card lesson-finish-task">
        <div className="lesson-finish-task__image-wrap">
          <img
            src={finishImageSrc}
            alt="Way to go! You finished the task!"
            className="lesson-finish-task__image"
            onError={(e) => {
              if (e.currentTarget.src !== `/courses/${courseId}/assets/finish/way-to-go.png`) {
                e.currentTarget.src = `/courses/${courseId}/assets/finish/way-to-go.png`;
              }
            }}
          />
        </div>

        <button
          type="button"
          className="lesson-finish-task__btn"
          onClick={handleBackToProfile}
        >
          Back to profile
        </button>
      </article>
    </LmsActivityFrame>
  );
}
