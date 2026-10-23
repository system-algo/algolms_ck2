import { useState, useEffect } from 'react';
import './FeedbackTask.css';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import { loadLocalTaskState, saveLocalTaskState } from '../lib/taskExtractors.js';
import { cleanTextLines } from '../lib/taskExtractors.js';
import robotDifficultImg from '../assets/feedback/robot-difficult.png';
import robotOkayImg from '../assets/feedback/robot-okay.png';
import robotMainImg from '../assets/feedback/robot-main.png';
import robotEasyImg from '../assets/feedback/robot-easy.png';

function getFeedbackOptions(feedbackBase = '') {
  return [
    { 
      value: 'sad', 
      label: 'Sad', 
      description: 'It was hard',
      filename: 'robot-difficult.png',
      imgSrc: feedbackBase ? `${feedbackBase}/robot-difficult.png` : robotDifficultImg,
      fallbackSrc: robotDifficultImg,
      circleClass: 'bg-sad',
      textClass: 'text-sad',
      thanksTitle: 'Thanks!',
      thanksSubtitle: 'We will try to do better :)',
      badgeStyle: {
        background: '#fef2f2',
        border: '1px solid #fecaca',
        color: '#991b1b',
      },
      dotColor: '#ef4444',
      heartBg: '#fee2e2',
      heartColor: '#ef4444',
      sparkleColor: '#ef4444',
    },
    { 
      value: 'neutral', 
      label: 'Neutral', 
      description: 'It was alright',
      filename: 'robot-okay.png',
      imgSrc: feedbackBase ? `${feedbackBase}/robot-okay.png` : robotOkayImg,
      fallbackSrc: robotOkayImg,
      circleClass: 'bg-neutral',
      textClass: 'text-neutral',
      thanksTitle: 'Thanks!',
      thanksSubtitle: 'We will try to do better :)',
      badgeStyle: {
        background: '#fffbeb',
        border: '1px solid #fef3c7',
        color: '#92400e',
      },
      dotColor: '#f59e0b',
      heartBg: '#fef3c7',
      heartColor: '#f59e0b',
      sparkleColor: '#f59e0b',
    },
    { 
      value: 'happy', 
      label: 'Happy', 
      description: 'It was great',
      filename: 'robot-main.png',
      imgSrc: feedbackBase ? `${feedbackBase}/robot-main.png` : robotMainImg,
      fallbackSrc: robotMainImg,
      circleClass: 'bg-happy',
      textClass: 'text-happy',
      thanksTitle: 'Thanks!',
      thanksSubtitle: 'We love having cool lessons!',
      badgeStyle: {
        background: '#f0fdf4',
        border: '1px solid #bbf7d0',
        color: '#166534',
      },
      dotColor: '#22c55e',
      heartBg: '#dcfce7',
      heartColor: '#22c55e',
      sparkleColor: '#22c55e',
    },
  ];
}

export default function FeedbackTask({
  task,
  state,
  onPrevTask,
  onNextTask,
  onBackToPages,
  onBackToCatalog,
  onBackToCourse,
  isTaskDone = false,
  completedTaskIds,
}) {
  const feedbackData = task?.feedback || state?.feedback || {};
  const lines = cleanTextLines(state?.textLines || []);
  const rawTitle = feedbackData.title || lines[0] || task?.title || '';
  const isLessonName = /lesson\s*\d+/i.test(rawTitle) || /interface/i.test(rawTitle) || !rawTitle || !rawTitle.includes('?');
  const title = feedbackData.title || (!isLessonName ? rawTitle : '') || 'Did you like the task?';

  const taskId = String(task?.id || task?.taskId || 'feedback').trim();
  const isAlreadyDone =
    isTaskDone ||
    (Array.isArray(completedTaskIds) && (completedTaskIds.includes(task?.id) || completedTaskIds.includes(taskId)));

  const [submitted, setSubmitted] = useState(() => {
    const saved = loadLocalTaskState(taskId, null);
    return saved?.submitted || false;
  });

  const [selected, setSelected] = useState(() => {
    const saved = loadLocalTaskState(taskId, null);
    return saved?.selected || '';
  });

  useEffect(() => {
    if (selected || submitted) {
      saveLocalTaskState(taskId, { selected, submitted });
    }
  }, [taskId, selected, submitted]);

  useEffect(() => {
    if (!submitted || isAlreadyDone) return;

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
    }, 800);

    return () => clearTimeout(timer);
  }, [submitted, task?.id, task?.taskId, isTaskDone]);

  function handleSelect(value) {
    setSelected(value);
    setSubmitted(true);
  }

  function handleNextClick() {
    const currentLesson =
      task?.lessonId ||
      state?.lessonId ||
      (() => {
        try {
          const params = new URLSearchParams(window.location.search);
          return params.get('lesson') || '';
        } catch {
          return '';
        }
      })() ||
      (() => {
        try {
          return (
            localStorage.getItem('lms_current_lesson_id') ||
            localStorage.getItem('algo_last_visited_lesson') ||
            ''
          );
        } catch {
          return '';
        }
      })();

    if (typeof onBackToPages === 'function') {
      onBackToPages(currentLesson);
      return;
    }
    if (typeof onBackToCatalog === 'function') {
      onBackToCatalog(currentLesson);
      return;
    }
    if (typeof onBackToCourse === 'function') {
      onBackToCourse(currentLesson);
      return;
    }
    const backBtn = document.querySelector('.back-to-course-btn');
    if (backBtn) {
      backBtn.click();
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const course = params.get('course') || 'GD';
    const lesson = currentLesson || params.get('lesson') || '';
    window.location.href = lesson
      ? `/?course=${encodeURIComponent(course)}&lesson=${encodeURIComponent(lesson)}`
      : `/?course=${encodeURIComponent(course)}`;
  }

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

  const feedbackOptions = getFeedbackOptions();

  return (
    <LmsActivityFrame
      title=""
      status=""
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
    >
      <article className="functional-card feedback-task">
        {submitted ? (() => {
          const selectedOption = feedbackOptions.find((opt) => opt.value === selected) || feedbackOptions[2];
          const thanksTitle = selectedOption.thanksTitle;
          const thanksSubtitle = selectedOption.thanksSubtitle;
          const robotImg = selectedOption.imgSrc;

          return (
            <div className="feedback-thanks-view">
              <div className="feedback-thanks-left">
                <div className="feedback-received-badge" style={selectedOption.badgeStyle}>
                  <span className="badge-dot" style={{ background: selectedOption.dotColor }} />
                  Feedback received
                </div>

                <h1 className="feedback-thanks-title">{thanksTitle}</h1>
                <p className="feedback-thanks-subtitle">{thanksSubtitle}</p>

                <div className="feedback-thanks-quote-box">
                  <div
                    className="quote-heart-badge"
                    style={{ background: selectedOption.heartBg, color: selectedOption.heartColor }}
                  >
                    ♥
                  </div>
                  <span>Your feedback helps us build better lessons.</span>
                </div>

                <button
                  type="button"
                  className="feedback-thanks-next-btn"
                  onClick={handleNextClick}
                >
                  <span>Next</span>
                  <span className="next-arrow">→</span>
                </button>
              </div>

              <div className="feedback-thanks-right">
                <div className="feedback-sparkles">
                  <span className="sparkle s1" style={{ color: selectedOption.sparkleColor }}>✦</span>
                  <span className="sparkle s2" style={{ color: selectedOption.sparkleColor }}>★</span>
                  <span className="sparkle s3" style={{ color: selectedOption.sparkleColor }}>◆</span>
                  <span className="sparkle s4" style={{ color: selectedOption.sparkleColor }}>✦</span>
                </div>
                <img
                  src={robotImg}
                  alt="Robot Feedback"
                  className="feedback-thanks-robot-img"
                  onError={(e) => {
                    if (selectedOption?.fallbackSrc) {
                      e.currentTarget.src = selectedOption.fallbackSrc;
                    }
                  }}
                />
              </div>
            </div>
          );
        })() : (
          <>
            <div className="feedback-task__badge">
              <img
                src={robotMainImg}
                alt=""
                className="feedback-task__badge-img"
                onError={(e) => {
                  e.currentTarget.src = '/assets/feedback/robot-main.png';
                }}
              />
              <div className="feedback-task__badge-text">
                <span className="feedback-task__badge-title">QUICK CHECK-IN</span>
                <span className="feedback-task__badge-subtitle">Your opinion matters</span>
              </div>
            </div>

            <h1>{title}</h1>
            <p className="feedback-task__description">Your feedback helps us make lessons better.</p>

            <div className="feedback-task__cards">
              {feedbackOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`feedback-task__card ${selected === option.value ? 'is-selected' : ''}`}
                  onClick={() => handleSelect(option.value)}
                >
                  <div className={`feedback-task__card-img-wrap ${option.circleClass}`}>
                    <img
                      src={option.imgSrc}
                      alt={option.label}
                      onError={(e) => {
                        if (option.fallbackSrc && e.currentTarget.src !== option.fallbackSrc) {
                          e.currentTarget.src = option.fallbackSrc;
                        } else {
                          e.currentTarget.src = `/assets/feedback/${option.filename}`;
                        }
                      }}
                    />
                  </div>
                  <h3 className={option.textClass}>{option.label}</h3>
                  <p>{option.description}</p>
                </button>
              ))}
            </div>
          </>
        )}
      </article>
    </LmsActivityFrame>
  );
}
