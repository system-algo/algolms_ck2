const NOISE_TEXT = new Set([
  'attempt',
  ': 1/2',
  'my solution',
  'tasks with automatic check',
  'answer',
  'check',
  'reset',
  'next',
  'back to lessons',
  'static content rendered from capture data.',
  'static content rendered from capture data',
]);

const CSS_NOISE_TEXT = new Set([
  'background-image',
  'background',
  'image',
  'url',
  'none',
]);

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCurrentRouteKey() {
  try {
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const courseId =
      params.get('course') ||
      params.get('courseId') ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('lms_current_course_id')) ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('lms_course_id')) ||
      'catalog';

    const lessonId =
      params.get('lesson') ||
      params.get('lessonId') ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('lms_current_lesson_id')) ||
      'course-home';

    const pageId =
      params.get('page') ||
      params.get('pageId') ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('lms_current_page_id')) ||
      '';

    return pageId ? `${courseId}:${lessonId}:${pageId}` : `${courseId}:${lessonId}`;
  } catch {
    return 'catalog:course-home';
  }
}

function getCurrentUserKey() {
  try {
    const email =
      sessionStorage.getItem('lms_student_email') ||
      localStorage.getItem('lms_student_email') ||
      localStorage.getItem('lms-user-id') ||
      '';
    const normalized = String(email).trim().toLowerCase();
    return normalized ? `u:${normalized}` : 'anon';
  } catch {
    return 'anon';
  }
}

function getLocalStorageKey(taskId) {
  const idStr =
    typeof taskId === 'object' && taskId !== null
      ? String(taskId.id || taskId.taskId || taskId.stateId || '').trim()
      : String(taskId || '').trim();

  if (
    idStr.startsWith('lms-replica:v2:') ||
    idStr.includes(':ide-code-v5') ||
    idStr.startsWith('typing-practice:v2:')
  ) {
    return idStr;
  }

  const userKey = getCurrentUserKey();
  const routeKey = getCurrentRouteKey();
  return `lms-replica:v2:${userKey}:${routeKey}:${idStr || 'unknown'}`;
}

function getPossibleLocalStorageKeys(taskId) {
  return [getLocalStorageKey(taskId)];
}

function isNoiseLine(line) {
  const text = normalizeText(line);
  const lower = text.toLowerCase();

  if (!text) return true;
  if (NOISE_TEXT.has(lower)) return true;
  if (CSS_NOISE_TEXT.has(lower)) return true;

  if (/^attempt\s*:?\s*\d+\/\d+$/i.test(text)) return true;
  if (/^part\s*\d*\.?$/i.test(text)) return true;
  if (/^item\s+\d+$/i.test(text)) return true;
  if (/^drop\s+here$/i.test(text)) return true;

  return false;
}

function isLikelyCssGarbage(text) {
  const lower = normalizeText(text).toLowerCase();

  if (!lower) return true;
  if (CSS_NOISE_TEXT.has(lower)) return true;
  if (lower.includes('[object')) return true;
  if (/^background[-\s]?image$/i.test(lower)) return true;
  if (/^background[-\s]?color$/i.test(lower)) return true;
  if (/^rgba?\(/i.test(lower)) return true;
  if (/^#[0-9a-f]{3,8}$/i.test(lower)) return true;

  return false;
}

export function uniqueTexts(values = []) {
  const seen = new Set();
  const result = [];

  values.forEach((value) => {
    const text = normalizeText(value);

    if (!text) return;

    const key = text.toLowerCase();

    if (seen.has(key)) return;

    seen.add(key);
    result.push(text);
  });

  return result;
}

export function cleanTextLines(lines = []) {
  return uniqueTexts(lines)
    .map(normalizeText)
    .filter((line) => !isNoiseLine(line));
}

export function getStates(task) {
  return Array.isArray(task?.states) ? task.states : [];
}

export function getBestState(task, predicate) {
  const states = getStates(task);
  return states.find(predicate) || states[0] || null;
}

export function getPrimaryState(task) {
  return (
    getBestState(task, (state) => Array.isArray(state.choiceOptions) && state.choiceOptions.length > 0) ||
    getBestState(task, (state) => Array.isArray(state.images) && state.images.length > 0) ||
    getBestState(task, (state) => Array.isArray(state.codeBlocks) && state.codeBlocks.length > 0) ||
    getStates(task)[0] ||
    null
  );
}

function getImageSrc(image) {
  return image?.localSrc || image?.publicSrc || image?.src || image?.url || image?.href || '';
}

function imageLooksUseful(image) {
  const src = getImageSrc(image);

  if (!src) return false;

  const width = image.naturalWidth || image.rect?.w || image.width || 0;
  const height = image.naturalHeight || image.rect?.h || image.height || 0;

  if (width < 12 && height < 12) return false;

  return true;
}

export function getUniqueImages(task) {
  const images = [];

  getStates(task).forEach((state) => {
    (state.images || []).forEach((image) => {
      if (!imageLooksUseful(image)) return;

      const width = image.naturalWidth || image.rect?.w || image.width || 0;
      const height = image.naturalHeight || image.rect?.h || image.height || 0;

      images.push({
        src: getImageSrc(image),
        alt: normalizeText(image.alt || image.title || image.label || ''),
        width,
        height,
        rect: image.rect || null,
      });
    });
  });

  const seen = new Set();

  return images.filter((image) => {
    const key = image.src;

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function getChoiceText(option) {
  return normalizeText(
    option?.text ||
      option?.label ||
      option?.title ||
      option?.value ||
      '',
  );
}

export function guessCorrectChoices(task) {
  const score = new Map();

  getStates(task).forEach((state, stateIndex) => {
    (state.choiceOptions || []).forEach((option) => {
      if (!option.checked) return;

      const text = getChoiceText(option);

      if (!text) return;

      const old = score.get(text) || 0;
      score.set(text, old + 1 + stateIndex * 0.01);
    });
  });

  if (!score.size) return [];

  const sorted = [...score.entries()].sort((a, b) => b[1] - a[1]);
  return [sorted[0][0]];
}

function parseMcqFromRawLines(task) {
  const state = getBestState(
    task,
    (item) => cleanTextLines(item.textLines || []).length >= 3,
  );

  const rawLines = cleanTextLines(state?.textLines || []);
  const title = task?.title || rawLines[0] || 'Question';

  const titleLower = normalizeText(title).toLowerCase();

  const usefulLines = rawLines.filter((line) => {
    const lower = normalizeText(line).toLowerCase();

    if (!lower) return false;
    if (lower === titleLower) return false;
    if (isLikelyCssGarbage(line)) return false;

    return true;
  });

  return {
    title,
    prompt: '',
    choices: usefulLines,
    correctChoices: [],
    images: getUniqueImages(task),
    multiple: false,
  };
}

export function getMcqData(task) {
  const state = getBestState(
    task,
    (item) => Array.isArray(item.choiceOptions) && item.choiceOptions.length > 0,
  );

  if (!state) {
    return parseMcqFromRawLines(task);
  }

  const choices = uniqueTexts((state.choiceOptions || []).map(getChoiceText));
  const choiceSet = new Set(choices.map((choice) => choice.toLowerCase()));

  const cleanLines = cleanTextLines(state.textLines || []);
  const questionLines = cleanLines.filter((line) => {
    const lower = line.toLowerCase();

    if (choiceSet.has(lower)) return false;
    if (isLikelyCssGarbage(line)) return false;

    return true;
  });

  const title = questionLines[0] || task?.title || 'Question';
  const prompt = questionLines.slice(1).join('\n');

  const optionTypes = new Set((state.choiceOptions || []).map((option) => option.type));
  const multiple = optionTypes.has('checkbox');

  return {
    title,
    prompt,
    choices,
    correctChoices: guessCorrectChoices(task),
    images: getUniqueImages(task),
    multiple,
  };
}

export function looksLikeMatchingTask(task) {
  const states = getStates(task);
  const hasChoices = states.some((state) => (state.choiceOptions || []).length > 0);

  if (hasChoices) return false;

  const primary = getPrimaryState(task);
  const lines = cleanTextLines(primary?.textLines || []);

  if (task?.activityType === 'matching_dragdrop_task') return true;
  if ((primary?.images || []).length >= 2 && lines.length >= 2) return true;
  if (lines.length >= 7) return true;
  if (/match|categorize|sequence|rule|purpose/i.test(lines.join(' '))) return true;

  return false;
}

function getMatchingState(task) {
  return (
    getBestState(task, (item) => {
      const lineCount = cleanTextLines(item.textLines || []).length;
      const imageCount = (item.images || []).filter(imageLooksUseful).length;

      return lineCount >= 2 && imageCount > 0;
    }) ||
    getBestState(task, (item) => cleanTextLines(item.textLines || []).length >= 5) ||
    getPrimaryState(task)
  );
}

function getStateImages(state) {
  const images = [];

  (state?.images || []).forEach((image) => {
    if (!imageLooksUseful(image)) return;

    const width = image.naturalWidth || image.rect?.w || image.width || 0;
    const height = image.naturalHeight || image.rect?.h || image.height || 0;

    images.push({
      src: getImageSrc(image),
      alt: normalizeText(image.alt || image.title || image.label || ''),
      width,
      height,
      rect: image.rect || null,
    });
  });

  const seen = new Set();

  return images.filter((image) => {
    const key = image.src;

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function splitMatchingLines(lines, imageCount) {
  const cleaned = cleanTextLines(lines).filter((line) => !isLikelyCssGarbage(line));

  if (!cleaned.length) {
    return {
      prompt: '',
      terms: [],
      targetLabels: [],
    };
  }

  const prompt = cleaned[0];
  const rest = cleaned.slice(1);

  if (imageCount > 0) {
    const terms = rest.filter((line) => {
      if (isLikelyCssGarbage(line)) return false;
      if (/^background[-\s]?image$/i.test(line)) return false;

      return true;
    });

    return {
      prompt,
      terms: terms.slice(0, Math.max(imageCount, 1)),
      targetLabels: [],
    };
  }

  const half = Math.ceil(rest.length / 2);

  return {
    prompt,
    terms: rest.slice(0, half),
    targetLabels: rest.slice(half),
  };
}

export function getMatchingData(task) {
  const state = getMatchingState(task);
  const stateImages = getStateImages(state);
  const allImages = getUniqueImages(task);

  const images = stateImages.length ? stateImages : allImages;
  const { prompt, terms, targetLabels } = splitMatchingLines(state?.textLines || [], images.length);

  if (images.length > 0) {
    return {
      title: task?.title || prompt || 'Match the items',
      prompt: prompt || task?.title || 'Match the items',
      terms: terms.map((text, index) => ({
        id: `term-${index}`,
        text,
      })),
      targets: images.map((image, index) => ({
        id: `target-${index}`,
        label: targetLabels[index] || image.alt || '',
        text: targetLabels[index] || image.alt || '',
        image,
      })),
    };
  }

  return {
    title: task?.title || prompt || 'Match the items',
    prompt: prompt || task?.title || 'Match the items',
    terms: terms.map((text, index) => ({
      id: `term-${index}`,
      text,
    })),
    targets: targetLabels.map((text, index) => ({
      id: `target-${index}`,
      label: text,
      text,
      image: null,
    })),
  };
}

export function looksLikeIdeTask(task) {
  const text = getStates(task)
    .flatMap((state) => state.textLines || [])
    .join(' ')
    .toLowerCase();

  const hasCodeBlock = getStates(task).some((state) => (state.codeBlocks || []).length > 0);

  if (hasCodeBlock) return true;

  if (/program should|input|output|seconds have passed|automatic check|code|python|javascript/i.test(text)) {
    return true;
  }

  const type = String(task?.activityType || '').toLowerCase();
  return type.includes('ide') || type.includes('programming') || type.includes('code');
}

export function getIdeData(task) {
  const state =
    getBestState(task, (item) => Array.isArray(item.codeBlocks) && item.codeBlocks.length > 0) ||
    getPrimaryState(task);

  const lines = cleanTextLines(state?.textLines || []);
  const title =
    lines.find((line) => line.length < 80 && !/^s seconds/i.test(line)) ||
    task?.documentTitle ||
    task?.title ||
    'Programming task';

  const codeBlock = (state?.codeBlocks || [])[0] || {};
  const starterCode =
    codeBlock.text ||
    codeBlock.value ||
    codeBlock.content ||
    codeBlock.code ||
    '# Write your code here\n';

  const problemLines = lines.filter((line) => line !== title);

  return {
    title,
    problemLines,
    starterCode,
    language: codeBlock.language || task?.language || 'python',
  };
}

export function saveLocalTaskState(taskId, value) {
  try {
    const keys = getPossibleLocalStorageKeys(taskId);
    if (!keys.length) return;
    localStorage.setItem(keys[0], JSON.stringify(value));
  } catch {
    // localStorage can fail in private or restricted browser modes.
  }
}

export function loadLocalTaskState(taskId, fallback) {
  try {
    const keys = getPossibleLocalStorageKeys(taskId);
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          return JSON.parse(raw);
        } catch {}
      }
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function calculateActiveTaskCount(manifest, manualActivityMap) {
  if (!manifest) return 0;
  let tasks = Array.isArray(manifest?.tasks) ? manifest.tasks : [];

  if (manualActivityMap && manualActivityMap.tasks && typeof manualActivityMap.tasks === 'object') {
    const allowedTaskIds = new Set(Object.keys(manualActivityMap.tasks));
    if (allowedTaskIds.size > 0) {
      tasks = tasks.filter((task) => {
        const taskId = String(task?.taskId || task?.id || '').trim();
        return allowedTaskIds.has(taskId);
      });
    }
  }

  if (tasks.length > 1) {
    tasks = tasks.filter((t) => {
      const taskId = String(t?.taskId || t?.id || '').trim();
      const mapConfig = manualActivityMap?.tasks?.[taskId];

      const title = String(mapConfig?.title || t?.title || '').toLowerCase().trim();
      const type = String(
        mapConfig?.selectedType ||
        mapConfig?.suggestedType ||
        mapConfig?.activityType ||
        t?.selectedType ||
        t?.manualSelectedType ||
        t?.activityType ||
        t?.type ||
        t?.rendererType ||
        t?.renderer?.type ||
        ''
      ).toLowerCase().trim();

      return !(
        type.includes('lesson-finish') ||
        type.includes('lesson_finish') ||
        type.includes('way-to-go') ||
        type.includes('way_to_go') ||
        title.includes('way to go') ||
        title.includes('you finished the task') ||
        title.includes('you completed the task')
      );
    });
  }

  return tasks.length;
}

export function resolveActivityMapUrl(raw) {
  if (!raw) return '';
  let rawPath = typeof raw === 'string' ? raw : (raw.url || raw.path || '');
  if (typeof rawPath !== 'string' || !rawPath) return '';
  let normalized = rawPath.replace(/\\/g, '/');

  // If it contains /manual-activity-maps/..., extract starting from /manual-activity-maps/
  const match = normalized.match(/\/manual-activity-maps\/.*$/i);
  if (match) {
    return match[0];
  }

  // If it starts with 'public/', replace 'public/' with '/'
  if (normalized.startsWith('public/')) {
    return '/' + normalized.slice(7);
  }

  // If it contains file:/// or C:/, try to strip local prefix
  if (normalized.startsWith('file://')) {
    normalized = normalized.replace(/^file:\/\/\/[a-z]:/i, '').replace(/^file:\/\//i, '');
  } else if (/^[a-z]:/i.test(normalized)) {
    normalized = normalized.replace(/^[a-z]:/i, '');
  }

  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }

  return normalized;
}