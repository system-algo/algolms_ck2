import { useEffect, useMemo, useState } from 'react';
import './YoutubeEmbedTask.css';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import { loadLocalTaskState, saveLocalTaskState, resolveActivityMapUrl } from '../lib/taskExtractors.js';

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTaskId(task) {
  return String(task?.id || task?.taskId || '').trim();
}

function getManualMapUrl(pageInstance) {
  return resolveActivityMapUrl(pageInstance?.manualActivityMap);
}

function collectText(value, output = [], depth = 0) {
  if (depth > 12 || value == null) return output;

  if (typeof value === 'string') {
    output.push(value);
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectText(item, output, depth + 1));
    return output;
  }

  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectText(item, output, depth + 1));
  }

  return output;
}

function findYoutubeUrl(task) {
  const text = collectText(task).join('\n');

  const match = text.match(
    /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtu\.be\/)[^\s"'<>]+)/i,
  );

  return match?.[1] || '';
}

function getYoutubeId(url) {
  const raw = String(url || '').trim();

  if (!raw) return '';

  try {
    const parsed = new URL(raw);

    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.replace('/', '').split(/[?&/]/)[0];
    }

    if (parsed.pathname.startsWith('/watch')) {
      return parsed.searchParams.get('v') || '';
    }

    if (parsed.pathname.startsWith('/embed/')) {
      return parsed.pathname.split('/embed/')[1]?.split(/[?&/]/)[0] || '';
    }

    if (parsed.pathname.startsWith('/shorts/')) {
      return parsed.pathname.split('/shorts/')[1]?.split(/[?&/]/)[0] || '';
    }
  } catch {
    return '';
  }

  return '';
}

function getEmbedUrl(config, task) {
  if (config?.embedUrl) return config.embedUrl;

  const url = config?.url || findYoutubeUrl(task);
  const videoId = getYoutubeId(url);

  if (!videoId) return '';

  return `https://www.youtube-nocookie.com/embed/${videoId}`;
}

function getFallbackConfig(task) {
  return {
    title: task?.title || 'Video lesson',
    url: findYoutubeUrl(task),
    embedUrl: '',
    description: '',
  };
}

export default function YoutubeEmbedTask({
  task,
  pageInstance,
  onPrevTask,
  onNextTask,
  isTaskDone,
  completedTaskIds,
}) {
  const taskId = getTaskId(task);
  const [localCompleted, setLocalCompleted] = useState(false);
  const isAlreadyDone =
    localCompleted ||
    isTaskDone ||
    (Array.isArray(completedTaskIds) && (completedTaskIds.includes(task?.id) || completedTaskIds.includes(taskId)));

  useEffect(() => {
    if (!taskId) return;
    saveLocalTaskState(taskId, { viewed: true });

    if (!isAlreadyDone) {
      setLocalCompleted(true);
      window.dispatchEvent(
        new CustomEvent('LMS_TASK_COMPLETED', {
          detail: { taskId },
        })
      );
    }
  }, [taskId, isAlreadyDone]);

  const fallbackConfig = useMemo(() => getFallbackConfig(task), [task]);

  const [manualConfig, setManualConfig] = useState(null);

  useEffect(() => {
    let cancelled = false;

    setManualConfig(null);

    const url = getManualMapUrl(pageInstance);

    if (!url || !taskId) return undefined;

    fetch(url)
      .then((response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((manualMap) => {
        if (cancelled || !manualMap) return;

        const manualTask = manualMap?.tasks?.[taskId] || null;

        const nextConfig =
          manualTask?.youtubeEmbed ||
          manualTask?.youtube ||
          manualTask?.videoLesson ||
          null;

        setManualConfig(nextConfig);
      })
      .catch(() => {
        if (!cancelled) {
          setManualConfig(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pageInstance, taskId]);

  const config = manualConfig || fallbackConfig;
  const title = normalizeText(config.title || fallbackConfig.title || 'Video lesson');
  const description = normalizeText(config.description || '');
  const embedUrl = getEmbedUrl(config, task);



  function handleCheck() {
    if (!isAlreadyDone) {
      setLocalCompleted(true);
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
    const iframe = document.querySelector('.youtube-embed-frame');
    if (iframe) {
      iframe.src = iframe.src;
    }
  }

  return (
    <LmsActivityFrame
      title={title}
      status=""
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
      onCheck={handleCheck}
      onReset={handleReset}
      footer={null}
      isTaskDone={isTaskDone}
    >
      <article className="youtube-embed-task">
        <div className="youtube-embed-card">
          <h1>{title}</h1>

          {description ? (
            <p className="youtube-embed-description">{description}</p>
          ) : null}

          {embedUrl ? (
            <div className="youtube-embed-frame-wrap">
              <iframe
                className="youtube-embed-frame"
                src={embedUrl}
                title={title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="youtube-embed-missing">
              Missing YouTube URL. Add youtubeEmbed.url in the manual activity map.
            </div>
          )}
        </div>
      </article>
    </LmsActivityFrame>
  );
}