import { useEffect, useState } from 'react';
import './LinkDownloadTask.css';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import { buildAuthenticatedActivityAttempt } from '../lib/ck2BackendAttempt.js';
import { loadLocalTaskState, saveLocalTaskState, resolveActivityMapUrl } from '../lib/taskExtractors.js';

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

function getLinkDownloadData(task, state, manualConfig) {
  return (
    manualConfig?.linkDownload ||
    manualConfig ||
    state?.linkDownload ||
    task?.linkDownload ||
    state?.downloadLink ||
    task?.downloadLink ||
    {}
  );
}

function RedCloudDownloadIcon() {
  return (
    <svg className="link-download-svg-icon" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Background Red Circle */}
      <circle cx="60" cy="60" r="54" fill="#E84A5F" />
      
      {/* White Cloud Shape */}
      <path
        d="M40 76C33.3726 76 28 70.6274 28 64C28 57.7346 32.8093 52.5907 39.0125 52.0526C40.6728 42.5028 48.9774 35.2 59 35.2C69.0226 35.2 77.3272 42.5028 78.9875 52.0526C85.1907 52.5907 90 57.7346 90 64C90 70.6274 84.6274 76 78 76H40Z"
        fill="#FFFFFF"
      />
      
      {/* Yellow Downward Arrow */}
      <path
        d="M60 48V68M60 68L50 58M60 68L70 58"
        stroke="#F5A623"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function LinkDownloadTask({
  task,
  state,
  pageInstance,
  onPrevTask,
  onNextTask,
  isTaskDone,
  completedTaskIds,
}) {
  const taskId = task?.id || task?.taskId || 'link-download-task';
  const isAlreadyDone =
    isTaskDone ||
    (Array.isArray(completedTaskIds) && (completedTaskIds.includes(task?.id) || completedTaskIds.includes(taskId)));
  const storageKey = `${taskId}:link-download-v1`;

  const [manualConfig, setManualConfig] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const url = resolveActivityMapUrl(pageInstance?.manualActivityMap);

    if (!url || !taskId) return undefined;

    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((manualMap) => {
        if (cancelled || !manualMap) return;
        const manualTask = manualMap?.tasks?.[taskId] || null;
        setManualConfig(manualTask);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [pageInstance, taskId]);

  const config = getLinkDownloadData(task, state, manualConfig);

  const title = config.title || task?.title || 'Track template';
  const instruction = config.instruction || config.prompt || 'Click on the picture to download the template';
  const linkUrl = config.linkUrl || config.url || config.href || 'https://pub.algoritmika.org/uploads/2022/10/Track_0_1666619198.rbxl';
  const imageUrl = config.imageUrl || config.image || '';

  const savedState = loadLocalTaskState(storageKey, {});
  const [isCompleted, setIsCompleted] = useState(savedState.completed || false);
  const [statusText, setStatusText] = useState(savedState.completed ? 'Downloaded' : '');

  async function handlePictureClick() {
    // Downloading a file and saving LMS progress are two separate actions.
    if (linkUrl) {
      const anchor = document.createElement('a');
      anchor.href = linkUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      if (config.downloadName) anchor.download = config.downloadName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    }

    setStatusText('Saving download progress...');
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
        activityType: 'link-download-task',
        answer: { linkUrl, downloaded: true },
      });
      const response = await fetch(`${base}/api/activity-attempts`, {
        method: 'POST', headers, body: JSON.stringify(payload),
      });
      if (!response.ok || (await response.json())?.ok !== true) {
        throw new Error('Backend did not save the download attempt.');
      }
      const completion = await fetch(`${base}/api/activity-completions`, {
        method: 'POST', headers,
        body: JSON.stringify({ ...payload, completionType: 'downloaded' }),
      });
      if (!completion.ok || (await completion.json())?.ok !== true) {
        throw new Error('Backend did not confirm download completion.');
      }

      setIsCompleted(true);
      setStatusText('Downloaded');
      saveLocalTaskState(storageKey, { completed: true, status: 'Downloaded' });
      if (!isAlreadyDone && !isCompleted) {
        import('../utils/lmsSounds.js')
          .then(({ playLmsSound, LMS_SOUND_TYPES }) =>
            playLmsSound(LMS_SOUND_TYPES.COMPLETE_ACTIVITY)
          ).catch(() => {});
        window.dispatchEvent(new CustomEvent('LMS_TASK_COMPLETED', {
          detail: { taskId },
        }));
      }
      if (onNextTask) setTimeout(onNextTask, 1000);
    } catch (error) {
      console.error('[LinkDownloadTask] Download happened, but cloud save failed:', error);
      setStatusText('File opened, but progress was not saved. Please retry.');
    }
  }


  function handleReset() {
    setIsCompleted(false);
    setStatusText('');
    saveLocalTaskState(storageKey, { completed: false, status: '' });
  }

  return (
    <LmsActivityFrame
      title={title}
      status={statusText}
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
      onCheck={handlePictureClick}
      onReset={handleReset}
      isTaskDone={isTaskDone}
    >
      <article className="link-download-container">
        <h2 className="link-download-instruction">{instruction}</h2>

        <div
          className="link-download-button-wrapper"
          onClick={handlePictureClick}
          role="button"
          tabIndex={0}
          title="Click to download"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              handlePictureClick();
            }
          }}
        >
          {imageUrl ? (
            <img src={imageUrl} alt="Download icon" className="link-download-icon-img" />
          ) : (
            <RedCloudDownloadIcon />
          )}
        </div>

        {isCompleted && (
          <div className="link-download-status-badge">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
            </svg>
            <span>Completed & Downloaded</span>
          </div>
        )}
      </article>
    </LmsActivityFrame>
  );
}
