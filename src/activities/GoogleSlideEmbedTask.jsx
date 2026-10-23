import { useEffect, useState } from 'react';
import './GoogleSlideEmbedTask.css';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import { loadLocalTaskState, saveLocalTaskState } from '../lib/taskExtractors.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function getTaskData(task) {
  return (
    task?.googleSlideEmbed ||
    task?.googleSlidesEmbed ||
    task?.googleSlides ||
    task?.slideEmbed ||
    task?.rendererData ||
    {}
  );
}

function getGoogleSlideEmbedUrl(rawUrl) {
  const url = normalizeText(rawUrl);

  if (!url) return '';

  // Published Google Slides embed URL
  if (url.includes('/pubembed')) {
    return url;
  }

  // Normal Google Slides embed URL
  if (url.includes('/embed')) {
    return url;
  }

  // Published presentation URL: /presentation/d/e/<published-id>/pub
  const publishedMatch = url.match(
    /\/presentation\/d\/e\/([^/]+)\/(?:pub|pubembed)/
  );

  if (publishedMatch?.[1]) {
    const publishedId = publishedMatch[1];

    return `https://docs.google.com/presentation/d/e/${publishedId}/pubembed?start=false&loop=false&delayms=3000`;
  }

  // Normal Google Slides URL: /presentation/d/<presentation-id>/
  const normalMatch = url.match(
    /\/presentation\/d\/([^/]+)/
  );

  if (normalMatch?.[1]) {
    const presentationId = normalMatch[1];

    return `https://docs.google.com/presentation/d/${presentationId}/embed?start=false&loop=false&delayms=3000`;
  }

  return url;
}

export default function GoogleSlideEmbedTask({
  task,
  onPrevTask,
  onNextTask,
  isTaskDone,
  completedTaskIds,
}) {
  const taskId = String(task?.id || task?.taskId || 'google-slide').trim();
  const [localCompleted, setLocalCompleted] = useState(false);
  const isAlreadyDone =
    localCompleted ||
    isTaskDone ||
    (Array.isArray(completedTaskIds) && (completedTaskIds.includes(task?.id) || completedTaskIds.includes(taskId)));

  useEffect(() => {
    if (!taskId) return;
    saveLocalTaskState(taskId, { viewed: true });
  }, [taskId]);

  const data = getTaskData(task);

  const title = normalizeText(data.title || task?.title || 'Google Slides');
  const description = normalizeText(data.prompt || data.prompt || '');
  const slideUrl = normalizeText(data.slideUrl || data.url || data.shareUrl || '');
  const embedUrl = getGoogleSlideEmbedUrl(data.embedUrl || slideUrl);
  const height = Number(data.height || 620);
  const openLabel = normalizeText(data.openLabel || 'Open Google Slides');

  return (
    <LmsActivityFrame
      title={title}
      status=""
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
      onCheck={() => {
        if (!isAlreadyDone) {
          setLocalCompleted(true);
          import('../utils/lmsSounds.js').then(({ playLmsSound, LMS_SOUND_TYPES }) => {
            playLmsSound(LMS_SOUND_TYPES.COMPLETE_ACTIVITY);
          }).catch(() => {});
          window.dispatchEvent(
            new CustomEvent('LMS_TASK_COMPLETED', {
              detail: { taskId: task?.id || task?.taskId },
            })
          );
          if (onNextTask) {
            setTimeout(onNextTask, 600);
          }
        }
      }}
      onReset={() => {
        // Just reload the iframe or do nothing for now
        const iframe = document.querySelector('.google-slide-frame');
        if (iframe) iframe.src = iframe.src;
      }}
      isTaskDone={isTaskDone}
    >
      <article className="google-slide-task">
        {embedUrl ? (
          <div
            className="google-slide-frame-wrap"
            style={{
              minHeight: `${height}px`,
            }}
          >
            <iframe
              className="google-slide-frame"
              src={embedUrl}
              title={title}
              allowFullScreen
              loading="lazy"
            />
          </div>
        ) : (
          <div className="google-slide-empty">
            Missing Google Slides URL.
          </div>
        )}
      </article>
    </LmsActivityFrame>
  );
}