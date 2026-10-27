import { useEffect, useMemo, useState } from 'react';
import './McqCheckboxTask.css';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import { buildAuthenticatedActivityAttempt } from '../lib/ck2BackendAttempt.js';
import {
  getMcqData,
  loadLocalTaskState,
  saveLocalTaskState,
  resolveActivityMapUrl,
} from '../lib/taskExtractors.js';

const API_BASE_URL = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const SESSION_STORAGE_KEY = 'algolms_session_id';

function normalizeText(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function normalizeInlineText(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function splitLines(value) {
  return normalizeText(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function uniqueList(items) {
  const seen = new Set();

  return items.filter((item) => {
    const key = String(item || '').toLowerCase();

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function getTaskId(task) {
  return String(task?.id || task?.taskId || '').trim();
}

function getManualMapUrl(pageInstance) {
  try {
    const params = new URLSearchParams(window.location.search);

    const courseId = params.get('course') || '';
    const lessonId = params.get('lesson') || '';
    const pageId = params.get('page') || '';

    if (courseId && lessonId && pageId) {
      return `/manual-activity-maps/${encodeURIComponent(courseId)}/${encodeURIComponent(
        lessonId,
      )}/${encodeURIComponent(pageId)}.activity-map.json`;
    }
  } catch {
    // Fallback to pageInstance below.
  }

  const rawMap = pageInstance?.manualActivityMap || pageInstance?.manualMapUrl;
  return resolveActivityMapUrl(rawMap);
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
    // Ignore and use pageInstance fallback below.
  }

  return {
    courseId: courseId || pageInstance?.courseId || pageInstance?.course?.id || pageInstance?.course || '',
    lessonId: lessonId || pageInstance?.lessonId || pageInstance?.lesson?.id || pageInstance?.lesson || '',
    pageId: pageId || pageInstance?.pageId || pageInstance?.page?.id || pageInstance?.id || '',
  };
}

function getSessionId() {
  try {
    const existing = localStorage.getItem(SESSION_STORAGE_KEY);

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

function stripBadInlineText(value) {
  return String(value || '')
    .replace(/url\((['"]?)(.*?)\1\)/gi, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/blob:\S+/gi, '')
    .replace(/data:image\/\S+/gi, '')
    .replace(/\buploads?\/\S+/gi, '')
    .replace(/\bassets?\/\S+/gi, '')
    .replace(/\bscreenshots?\/\S+/gi, '')
    .replace(/\S+\.(png|jpe?g|webp|gif|svg)(\?\S*)?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBadMcqLabel(value) {
  const text = String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (!text) return true;

  return (
    text === 'background-image' ||
    text === 'background image' ||
    text === 'background' ||
    text.includes('background-image') ||
    text.startsWith('http://') ||
    text.startsWith('https://') ||
    text.startsWith('blob:') ||
    text.startsWith('data:image/') ||
    text.includes('lms.logikaschool.com/upload') ||
    text.includes('/upload/') ||
    text.includes('/uploads/') ||
    text.includes('/assets/') ||
    text.includes('/screenshots/') ||
    /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(text)
  );
}

function cleanMcqLabel(value) {
  const cleanedWholeText = stripBadInlineText(value);

  const lines = splitLines(cleanedWholeText)
    .map(stripBadInlineText)
    .map(normalizeInlineText)
    .filter((line) => !isBadMcqLabel(line));

  return lines.join('\n').trim();
}

function firstCleanText(...values) {
  for (const value of values) {
    const text = cleanMcqLabel(value);

    if (text) return text;
  }

  return '';
}

function parseChoicesFromPrompt(prompt, title) {
  const titleText = normalizeText(title);
  const lines = splitLines(prompt);

  if (!lines.length) {
    return {
      prompt: '',
      choices: [],
      correctChoices: [],
    };
  }

  const answerIndex = lines.findIndex((line) => /^answer$/i.test(line));
  const hasAnswerLabel = answerIndex >= 0;

  let promptLines = [];
  let choiceLines = [];

  if (hasAnswerLabel) {
    promptLines = lines.slice(0, answerIndex);
    choiceLines = lines.slice(answerIndex + 1);
  } else {
    choiceLines = lines;
  }

  promptLines = promptLines.filter((line) => line !== titleText);

  choiceLines = choiceLines.filter((line) => {
    if (!line) return false;
    if (line === titleText) return false;
    if (/^answer$/i.test(line)) return false;
    if (/^attempt:\s*\d+\s*\/\s*\d+$/i.test(line)) return false;
    return true;
  });

  const choices = uniqueList(choiceLines);

  return {
    prompt: promptLines.join('\n'),
    choices,
    correctChoices: hasAnswerLabel && choices.length ? [choices[0]] : [],
  };
}

function getImageSrc(image) {
  return (
    image?.localSrc ||
    image?.publicSrc ||
    image?.src ||
    image?.url ||
    image?.href ||
    image?.imageSrc ||
    ''
  );
}

function makeOptionKey(option, index) {
  if (option?.imageSrc) {
    return `image:${option.imageSrc}:${index}`;
  }

  if (option?.id) {
    return `id:${option.id}:${index}`;
  }

  return `text:${option?.value || option?.text || `choice-${index + 1}`}:${index}`;
}

function normalizeOption(rawOption, index) {
  if (typeof rawOption === 'string') {
    const text = cleanMcqLabel(rawOption) || normalizeText(rawOption);

    return {
      id: `choice-${index + 1}`,
      key: `text:${text}:${index}`,
      value: text,
      text,
      imageSrc: '',
      imageAlt: text,
    };
  }

  const imageSrc =
    rawOption?.imageSrc ||
    rawOption?.src ||
    rawOption?.localSrc ||
    rawOption?.publicSrc ||
    rawOption?.image?.localSrc ||
    rawOption?.image?.publicSrc ||
    rawOption?.image?.src ||
    rawOption?.image?.url ||
    '';

  const text = firstCleanText(
    rawOption?.text,
    rawOption?.label,
    rawOption?.title,
    rawOption?.caption,
    rawOption?.name,
  );

  const id = String(rawOption?.id || rawOption?.optionId || `choice-${index + 1}`);
  const rawValue = firstCleanText(rawOption?.value, text, id);
  const value = normalizeText(rawValue || id);

  const option = {
    id,
    value,
    text,
    imageSrc,
    imageAlt: firstCleanText(rawOption?.alt, rawOption?.image?.alt, text),
  };

  return {
    ...option,
    key: makeOptionKey(option, index),
  };
}

function normalizeOptions(rawOptions = []) {
  const seen = new Set();

  return rawOptions
    .map(normalizeOption)
    .filter((option) => option.value || option.text || option.imageSrc)
    .filter((option) => {
      const key = option.key;

      if (seen.has(key)) return false;

      seen.add(key);
      return true;
    });
}

function buildOptionsFromChoices(choices, images = [], pairImages = false) {
  const safeChoices = Array.isArray(choices) ? choices : [];
  const safeImages = Array.isArray(images) ? images : [];

  return safeChoices.map((choice, index) => {
    const text = cleanMcqLabel(choice) || normalizeText(choice);
    const image = pairImages ? safeImages[index] : null;
    const imageSrc = image ? getImageSrc(image) : '';

    const option = {
      id: `choice-${index + 1}`,
      value: text,
      text,
      imageSrc,
      imageAlt: firstCleanText(image?.alt, text),
    };

    return {
      ...option,
      key: makeOptionKey(option, index),
    };
  });
}

function buildOptionsFromImages(images = []) {
  const seen = new Set();

  return images
    .map((image, index) => {
      const imageSrc = getImageSrc(image);

      const text = firstCleanText(
        image?.label,
        image?.text,
        image?.title,
        image?.caption,
        image?.name,
        image?.alt,
      );

      const id = String(image?.id || image?.imageId || `image-choice-${index + 1}`);

      const option = {
        id,
        value: normalizeText(firstCleanText(image?.value, text, id) || id),
        text,
        imageSrc,
        imageAlt: firstCleanText(image?.alt, text),
      };

      return {
        ...option,
        key: makeOptionKey(option, index),
      };
    })
    .filter((option) => option.imageSrc)
    .filter((option) => {
      const key = option.key;

      if (seen.has(key)) return false;

      seen.add(key);
      return true;
    });
}

function normalizeMcqData(rawData, task, manualConfig = null) {
  const data = rawData || {};
  const config = manualConfig || {};
  const title = config.title || data.title || task?.title || '';

  let choices = Array.isArray(config.choices)
    ? config.choices.map((choice) => cleanMcqLabel(choice) || normalizeText(choice)).filter(Boolean)
    : Array.isArray(data.choices)
      ? data.choices.map((choice) => cleanMcqLabel(choice) || normalizeText(choice)).filter(Boolean)
      : [];

  let correctChoices = Array.isArray(config.correctChoices)
    ? config.correctChoices.map((choice) => normalizeText(choice)).filter(Boolean)
    : Array.isArray(config.correctAnswers)
      ? config.correctAnswers.map((choice) => normalizeText(choice)).filter(Boolean)
      : Array.isArray(data.correctChoices)
        ? data.correctChoices.map((choice) => normalizeText(choice)).filter(Boolean)
        : [];

  let prompt = normalizeText(config.prompt ?? data.prompt);

  if (!choices.length && prompt) {
    const parsed = parseChoicesFromPrompt(prompt, title);

    prompt = parsed.prompt;
    choices = parsed.choices;

    if (!correctChoices.length) {
      correctChoices = parsed.correctChoices;
    }
  }

  if (choices.length === 1 && choices[0].includes('\n')) {
    const parsed = parseChoicesFromPrompt(choices[0], title);

    choices = parsed.choices;

    if (!correctChoices.length) {
      correctChoices = parsed.correctChoices;
    }
  }

  choices = uniqueList(choices);
  correctChoices = uniqueList(correctChoices);

  const images = Array.isArray(config.images)
    ? config.images
    : Array.isArray(data.images)
      ? data.images
      : [];

  let layout = config.layout || data.layout || '';
  let options = [];

  if (Array.isArray(config.options) && config.options.length) {
    options = normalizeOptions(config.options);
  } else if (Array.isArray(data.options) && data.options.length) {
    options = normalizeOptions(data.options);
  } else if (choices.length) {
    options = buildOptionsFromChoices(choices, images, layout === 'image-grid');
  } else if (images.length) {
    options = buildOptionsFromImages(images);
    layout = 'image-grid';
  }

  const hasImageOptions = options.some((option) => option.imageSrc);

  if (hasImageOptions && layout !== 'image-grid') {
    layout = 'image-grid';
  }

  const optionValues = options.map((option) => option.value).filter(Boolean);

  if (!choices.length && optionValues.length) {
    choices = optionValues;
  }

  if (prompt && choices.length) {
    const choiceSet = new Set([
      ...choices.map((c) => normalizeText(c).toLowerCase()),
      ...options.map((o) => normalizeText(o.text || o.value).toLowerCase()),
    ].filter(Boolean));

    const promptLines = splitLines(prompt).filter((line) => {
      const lower = normalizeText(line).toLowerCase();
      if (!lower) return false;
      if (lower === normalizeText(title).toLowerCase()) return false;
      if (choiceSet.has(lower)) return false;
      return true;
    });

    prompt = promptLines.join('\n');
  }

  const usedImageSrcs = new Set(
    hasImageOptions
      ? options.map((option) => option.imageSrc).filter(Boolean)
      : [],
  );

  const displayImages = images.filter((image) => {
    const src = getImageSrc(image);

    if (!src) return false;

    return !usedImageSrcs.has(src);
  });

  const explicitMultiple =
    config.multiple ??
    config.isMultiple ??
    task?.mcqCheckbox?.multiple ??
    task?.mcqCheckbox?.isMultiple ??
    task?.multiple ??
    task?.isMultiple;

  const isQuestionPlural = /what parts|which parts|which ones|what properties|which properties|what parameters|which parameters|which mechanics|which options|which of the|determine which|which are|features of|which features|what kinds|which kinds|what objects|which objects|select all|choose all|more than one|multiple|mark all|correct statements/i.test(
    `${title} ${prompt}`
  );

  const multiple =
    explicitMultiple !== undefined
      ? Boolean(explicitMultiple)
      : isQuestionPlural || hasImageOptions || correctChoices.length > 1;

  return {
    ...data,
    title,
    prompt,
    choices,
    options,
    correctChoices,
    images: displayImages,
    multiple,
    layout,
    attempt: config.attempt || data.attempt || task?.attempt || 'Attempt: 1/2',
  };
}

function getCorrectKeys(correctChoices, options) {
  return correctChoices
    .map((correctChoice) => {
      const correctText = normalizeText(correctChoice).toLowerCase();

      const matchedOption = options.find((option) => (
        normalizeText(option.value).toLowerCase() === correctText ||
        normalizeText(option.text).toLowerCase() === correctText ||
        normalizeText(option.id).toLowerCase() === correctText
      ));

      return matchedOption?.key || `text:${correctChoice}`;
    })
    .filter(Boolean);
}

function getSelectedOptionIds(selectedKeys, options) {
  return selectedKeys
    .map((choiceKey) => {
      const matchedOption = options.find((option, index) => (
        (option.key || makeOptionKey(option, index)) === choiceKey
      ));

      return matchedOption?.id || '';
    })
    .filter(Boolean);
}

async function submitMcqAttempt({
  pageInstance,
  task,
  selected,
  options,
}) {
  if (!API_BASE_URL) {
    return null;
  }

  const taskId = getTaskId(task);
  const { courseId, lessonId, pageId } = getRuntimeIds(pageInstance);

  if (!courseId || !lessonId || !pageId || !taskId) {
    throw new Error('Missing courseId, lessonId, pageId, or taskId.');
  }

  const selectedOptionIds = getSelectedOptionIds(selected, options);

  const studentEmail =
    sessionStorage.getItem('lms_student_email') ||
    localStorage.getItem('lms_student_email') || '';
  const accessToken =
    sessionStorage.getItem('lms_access_token') ||
    localStorage.getItem('lms_access_token') || '';
  const { headers, payload: attemptPayload } = buildAuthenticatedActivityAttempt({
    studentEmail,
    accessToken,
    courseId,
    lessonId,
    pageId,
    taskId,
    activityType: 'mcq-checkbox',
    answer: { selectedOptionIds },
  });
  const response = await fetch(`${API_BASE_URL}/api/activity-attempts`, {
    method: 'POST',
    headers,
    body: JSON.stringify(attemptPayload),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message || 'Could not submit answer.');
  }

  return payload;
}

export default function McqCheckboxTask({
  task,
  pageInstance,
  onPrevTask,
  onNextTask,
  isTaskDone,
}) {
  const taskId = getTaskId(task);
  const rawData = useMemo(() => getMcqData(task), [task]);
  const [manualConfig, setManualConfig] = useState(null);
  const [checking, setChecking] = useState(false);

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
          manualTask?.mcqCheckbox ||
          manualTask?.mcq ||
          manualTask?.data ||
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

  const data = useMemo(
    () => normalizeMcqData(rawData, task, manualConfig),
    [rawData, task, manualConfig],
  );

  const [selected, setSelected] = useState(() => {
    const saved = loadLocalTaskState(taskId, null);
    return saved?.selected || [];
  });

  const [status, setStatus] = useState(() => {
    const saved = loadLocalTaskState(taskId, null);
    return saved?.status || '';
  });

  useEffect(() => {
    const saved = loadLocalTaskState(taskId, null);

    if (saved?.selected) {
      setSelected(saved.selected);
    }
    if (saved?.status) {
      setStatus(saved.status);
    }
  }, [taskId]);

  useEffect(() => {
    if (selected.length > 0 || status) {
      saveLocalTaskState(taskId, { selected, status });
    }
  }, [taskId, selected, status]);

  function toggleChoice(choiceKey) {
    setStatus('');

    if (data.multiple) {
      setSelected((current) => (
        current.includes(choiceKey)
          ? current.filter((item) => item !== choiceKey)
          : [...current, choiceKey]
      ));
      return;
    }

    setSelected([choiceKey]);
  }

  function checkAnswerLocally() {
    if (!data.correctChoices.length) {
      return 'Answer saved locally. No answer key found in this ZIP.';
    }

    const selectedKey = [...selected].sort().join('|');
    const correctKey = getCorrectKeys(data.correctChoices, data.options).sort().join('|');

    return selectedKey === correctKey ? 'You got it!' : 'Try again';
  }

  function triggerSuccess() {
    if (!isTaskDone) {
      window.dispatchEvent(
        new CustomEvent('LMS_TASK_COMPLETED', {
          detail: { taskId: task?.id || task?.taskId },
        })
      );
      if (onNextTask) {
        setTimeout(onNextTask, 1000);
      }
    }
  }

  async function checkAnswer() {
    if (!selected.length) {
      setStatus('Please choose an answer before checking.');
      return;
    }

    setChecking(true);
    setStatus('Checking...');

    try {
      const payload = await submitMcqAttempt({
        pageInstance,
        task,
        selected,
        options: data.options,
      });

      if (!payload) {
        setStatus('Answer was not saved on the backend. Please try again.');
        return;
      }

      const result = payload.result || payload.attempt?.result || {};
      const nextStatus = result.status || payload.attempt?.status || '';

      if (result.isCorrect === true || payload.attempt?.isCorrect === true) {
        setStatus('You got it!');
        triggerSuccess();
        return;
      }

      if (result.isCorrect === false || payload.attempt?.isCorrect === false) {
        setStatus('Try again');
        return;
      }

      if (nextStatus === 'missing_answer_key') {
        setStatus('Answer saved. No backend answer key found.');
        return;
      }

      if (result.feedback || payload.attempt?.feedback) {
        setStatus(result.feedback || payload.attempt.feedback);
        return;
      }

      setStatus('Answer saved.');
    } catch (error) {
      console.error('[MCQ_SUBMIT_ERROR]', error);
      setStatus('Answer was not saved on the backend. Please try again.');
    } finally {
      setChecking(false);
    }
  }

  function resetAnswer() {
    setSelected([]);
    setStatus('');
  }

  const hasVisualChoices =
    data.layout === 'image-grid' &&
    data.options.some((option) => option.imageSrc);

  return (
    <LmsActivityFrame
      title={data.title}
      status={status}
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
      onCheck={checkAnswer}
      onReset={resetAnswer}
      isCheckDisabled={checking}
      isResetDisabled={checking}
      isCheckLoading={checking}
      isTaskDone={isTaskDone}
    >
      <article className="functional-card mcq-card">
        <h1>{data.title}</h1>

        {data.prompt && <p className="task-prompt">{data.prompt}</p>}

        {!hasVisualChoices && data.images.length > 0 && (
          <div className="image-strip">
            {data.images.slice(0, 3).map((image) => (
              <img key={getImageSrc(image)} src={getImageSrc(image)} alt={image.alt || ''} />
            ))}
          </div>
        )}

        <div className={`choice-list ${hasVisualChoices ? 'mcq-visual-choice-list' : ''}`}>
          {data.options.map((option, index) => {
            const choiceKey = option.key || makeOptionKey(option, index);
            const isSelected = selected.includes(choiceKey);
            const hasImage = Boolean(option.imageSrc);
            const displayText = hasVisualChoices
              ? cleanMcqLabel(option.text)
              : cleanMcqLabel(option.text || option.value);
            const hasText = Boolean(displayText);

            return (
              <button
                key={choiceKey}
                type="button"
                className={`choice-item ${isSelected ? 'selected' : ''} ${hasVisualChoices ? 'mcq-visual-choice' : ''} ${hasImage ? 'has-image' : 'text-only'}`}
                onClick={() => toggleChoice(choiceKey)}
                disabled={checking}
              >
                <span className={data.multiple ? 'checkbox-ui' : 'radio-ui'}>
                  {isSelected ? '✓' : ''}
                </span>

                {hasVisualChoices ? (
                  <span className="mcq-choice-content">
                    {hasImage ? (
                      <span className="mcq-choice-image-wrap">
                        <img
                          className="mcq-choice-image"
                          src={option.imageSrc}
                          alt={option.imageAlt || displayText || ''}
                        />
                      </span>
                    ) : null}

                    {hasText ? (
                      <span className="mcq-choice-text">
                        {displayText}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span>{displayText || option.value}</span>
                )}
              </button>
            );
          })}
        </div>
      </article>
    </LmsActivityFrame>
  );
}