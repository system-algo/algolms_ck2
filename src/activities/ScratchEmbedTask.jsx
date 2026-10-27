import { useState } from 'react';
import './ScratchEmbedTask.css';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import { buildAuthenticatedActivityAttempt } from '../lib/ck2BackendAttempt.js';
import { loadLocalTaskState, saveLocalTaskState } from '../lib/taskExtractors.js';

function getBackendBaseUrl() {
  return String(
    import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL ||
    sessionStorage.getItem('lms_backend_url') ||
    localStorage.getItem('lms_backend_url') || ''
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
  } catch {
    // Ignore
  }

  return {
    courseId: courseId || pageInstance?.courseId || pageInstance?.course?.id || pageInstance?.course || '',
    lessonId: lessonId || pageInstance?.lessonId || pageInstance?.lesson?.id || pageInstance?.lesson || '',
    pageId: pageId || pageInstance?.pageId || pageInstance?.page?.id || pageInstance?.id || '',
  };
}

function getScratchData(task, state) {
  return (
    state?.scratchEmbed ||
    task?.scratchEmbed ||
    state?.scratch ||
    task?.scratch ||
    task?.rendererData ||
    {}
  );
}

export default function ScratchEmbedTask({
  task,
  state,
  pageInstance,
  onPrevTask,
  onNextTask,
  isTaskDone,
  completedTaskIds,
}) {
  const scratchData = getScratchData(task, state);
  const taskId = task?.id || task?.taskId || 'scratch-task';
  const isAlreadyDone =
    isTaskDone ||
    (Array.isArray(completedTaskIds) && (completedTaskIds.includes(task?.id) || completedTaskIds.includes(taskId)));
  const storageKey = `${taskId}:scratch-v1`;

  const savedState = loadLocalTaskState(storageKey, {});
  const [inputValue, setInputValue] = useState(savedState.answer || '');
  const [isRunning, setIsRunning] = useState(savedState.isRunning ?? true);
  const [statusText, setStatusText] = useState(savedState.status || '');

  const title = scratchData.title || task?.title || 'Robux store';
  const speechText = scratchData.speech || scratchData.prompt || 'Enter the password to receive robucks';
  const embedUrl = scratchData.embedUrl || scratchData.url || task?.embedUrl || '';
  const spriteImage = scratchData.spriteImage || '/courses/GD/GD_M1L10/pages/GD_M1L10_1/screenshots/0002-task-1-1al6kvb-after-1-Go.png';

  function handleFlagClick() {
    setIsRunning(true);
    setStatusText('Running Scratch project...');
  }

  function handleStopClick() {
    setIsRunning(false);
    setStatusText('Stopped.');
  }

  function handleReset() {
    setInputValue('');
    setIsRunning(true);
    setStatusText('');
    saveLocalTaskState(storageKey, { answer: '', isRunning: true, status: '' });
  }

  async function handleSubmit(e) {
    if (e) e.preventDefault();
    if (!inputValue.trim()) {
      setStatusText('Please submit the answer first.');
      return;
    }

    // Preserve the student answer as a local draft until cloud persistence succeeds.
    saveLocalTaskState(storageKey, {
      answer: inputValue, isRunning, status: 'Saved locally.',
    });
    setStatusText('Saving your answer...');
    try {
      const base = getBackendBaseUrl();
      if (!base) throw new Error('LMS backend URL is not configured.');
      const { courseId, lessonId, pageId } = getRuntimeIds(pageInstance);
      const studentEmail =
        sessionStorage.getItem('lms_student_email') ||
        localStorage.getItem('lms_student_email') || '';
      const accessToken =
        sessionStorage.getItem('lms_access_token') ||
        localStorage.getItem('lms_access_token') || '';
      const { headers, payload } = buildAuthenticatedActivityAttempt({
        studentEmail, accessToken, courseId, lessonId, pageId, taskId,
        activityType: 'scratch-embed-task',
        answer: { value: inputValue },
      });
      const response = await fetch(`${base}/api/activity-attempts`, {
        method: 'POST', headers, body: JSON.stringify(payload),
      });
      if (!response.ok || (await response.json())?.ok !== true) {
        throw new Error('Could not save Scratch answer.');
      }
      const completion = await fetch(`${base}/api/activity-completions`, {
        method: 'POST', headers, body: JSON.stringify({
          ...payload, completionType: 'submitted',
        }),
      });
      if (!completion.ok || (await completion.json())?.ok !== true) {
        throw new Error('Could not confirm Scratch task completion.');
      }
      setStatusText('Completed');
      saveLocalTaskState(storageKey, {
        answer: inputValue, isRunning, status: 'Completed',
      });
      if (!isAlreadyDone) {
        import('../utils/lmsSounds.js')
          .then(({ playLmsSound, LMS_SOUND_TYPES }) => {
            playLmsSound(LMS_SOUND_TYPES.COMPLETE_ACTIVITY);
          }).catch(() => {});
        window.dispatchEvent(new CustomEvent('LMS_TASK_COMPLETED', {
          detail: { taskId },
        }));
      }
      if (onNextTask) setTimeout(onNextTask, 600);
    } catch (error) {
      console.error('[ScratchEmbedTask] Could not save CK2 submission:', error);
      setStatusText('Saved locally, but not synced. Please retry.');
    }
  }

  return (
    <LmsActivityFrame
      title={title}
      status={statusText}
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
      onCheck={handleSubmit}
      onReset={handleReset}
      isTaskDone={isTaskDone}
    >
      <article className="scratch-embed-container">
        {embedUrl ? (
          <div className="scratch-iframe-wrap">
            <iframe
              className="scratch-iframe"
              src={embedUrl}
              title={title}
              allow="autoplay; fullscreen"
            />
          </div>
        ) : (
          <div className="scratch-stage-window">
            {/* Top Toolbar with Green Flag & Stop Buttons */}
            <div className="scratch-top-bar">
              <button
                type="button"
                className={`scratch-flag-btn ${isRunning ? 'active' : ''}`}
                onClick={handleFlagClick}
                title="Go (Green Flag)"
                aria-label="Start Scratch project"
              >
                <svg className="scratch-flag-icon" viewBox="0 0 24 24">
                  <path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6h-5.6z" />
                </svg>
              </button>

              <button
                type="button"
                className="scratch-stop-btn"
                onClick={handleStopClick}
                title="Stop"
                aria-label="Stop Scratch project"
              >
                <svg className="scratch-stop-icon" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
                </svg>
              </button>
            </div>

            {/* Stage Canvas Area */}
            <div className="scratch-stage-canvas">
              {isRunning && (
                <div className="scratch-sprite-container">
                  <div className="scratch-speech-bubble">
                    {speechText}
                  </div>
                  {spriteImage && (
                    <div className="scratch-sprite-crop-wrapper">
                      <img
                        src={spriteImage}
                        alt="Scratch Sprite"
                        className="scratch-sprite-crop-img"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Bottom Interactive Scratch Input */}
              {isRunning && (
                <div className="scratch-input-bar">
                  <form className="scratch-input-form" onSubmit={handleSubmit}>
                    <input
                      type="text"
                      className="scratch-input-field"
                      value={inputValue}
                      onChange={(e) => {
                        setInputValue(e.target.value);
                        if (statusText && statusText.toLowerCase().includes('submit')) {
                          setStatusText('');
                        }
                      }}
                      placeholder=""
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="scratch-submit-btn"
                      title="Submit answer"
                      aria-label="Submit answer"
                    >
                      <svg viewBox="0 0 24 24">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        )}
      </article>
    </LmsActivityFrame>
  );
}
