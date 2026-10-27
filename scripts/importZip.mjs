import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const INPUT_DIR = path.resolve('input');
const PUBLIC_DIR = path.resolve('public');
const COURSES_ROOT = path.resolve('public/courses');
const GENERATED_PAGES_ROOT = path.resolve('src/generated-pages');
const GENERATED_PAGE_SHELL_TEMPLATE_PATH = path.resolve('src/templates/GeneratedPageShell.jsx');
const MANUAL_ACTIVITY_MAPS_ROOT = path.resolve('public/manual-activity-maps');
const CACHE_FILE = path.join(COURSES_ROOT, '.import-cache.json');

const PAGE_INSTANCE_SCHEMA_VERSION = 2;
const RENDERER_VERSION = 'manual-v1';
const GENERIC_ACTIVITY_TYPE = 'generic-captured-task';

const MANUAL_ACTIVITY_TYPES = [
  'generic-captured-task',
  'sequence-order-task',
  'matching-connect',
  'mcq-checkbox',
  'matching-dragdrop',
  'typing-practice',
  'ide-programming',
  'diagram-canvas-task',
  'fill-blank-task',
  'video-lesson',
  'scratch-embed-task',
];

const RAW_ACTIVITY_TYPE_SUGGESTIONS = {
  generic_captured_task: 'generic-captured-task',
  generic_captured: 'generic-captured-task',
  mcq_checkbox_task: 'mcq-checkbox',
  multiple_choice_task: 'mcq-checkbox',
  matching_connect_task: 'matching-connect',
  matching_connect: 'matching-connect',
  matching_dragdrop_task: 'matching-dragdrop',
  matching_task: 'matching-dragdrop',
  code_typing_task: 'typing-practice',
  typing_practice_task: 'typing-practice',
  ide_programming_task: 'ide-programming',
  programming_task: 'ide-programming',
  diagram_canvas_task: 'diagram-canvas-task',
  visual_diagram_task: 'diagram-canvas-task',
  fill_blank_task: 'fill-blank-task',
  video_lesson: 'video-lesson',
  scratch_embed_task: 'scratch-embed-task',
};

const DEFAULT_FRAME_CONFIG = {
  showTopNavigation: true,
  showSideNavigation: true,
  showBottomControls: true,
  showNextButton: true,
  crop: {
    left: 90,
    right: 90,
    top: 60,
    bottom: 170,
  },
};

function parseCliArgs(argv) {
  const options = {
    watch: false,
    force: false,
    clean: false,
    noCache: false,
    help: false,
    positional: [],
  };

  argv.forEach((arg) => {
    if (arg === '--watch' || arg === '-w') {
      options.watch = true;
      return;
    }

    if (arg === '--force' || arg === '-f') {
      options.force = true;
      return;
    }

    if (arg === '--clean') {
      options.clean = true;
      return;
    }

    if (arg === '--no-cache') {
      options.noCache = true;
      return;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      return;
    }

    options.positional.push(arg);
  });

  return options;
}

const cli = parseCliArgs(process.argv.slice(2));
const rawInputPath = cli.positional[0] || '';
const rawTargetRoot = cli.positional[1] || '';
let currentPublicBase = '/courses/current';

function printHelp() {
  console.log('');
  console.log('Usage:');
  console.log('  npm run import');
  console.log('  npm run import -- ./input/WDY2');
  console.log('  npm run import -- ./input/WDY2/WDY2_M3L1/WDY2_M3L1_1.zip');
  console.log('');
  console.log('Options:');
  console.log('  --watch      Keep watching input/ and auto-import when ZIP files change');
  console.log('  --force      Re-import every ZIP even if the hash did not change');
  console.log('  --clean      Delete generated public/courses and src/generated-pages before importing');
  console.log('  --no-cache   Do not use the incremental import cache');
  console.log('');
  console.log('Manual activity maps:');
  console.log('  Import creates files in manual-activity-maps/<course>/<lesson>/<page>.activity-map.json');
  console.log('  Edit selectedType in that file, then run import again. The ZIP is not modified.');
  console.log('');
}

if (cli.help) {
  printHelp();
  process.exit(0);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function getCacheKey(filePath) {
  const relativePath = path.relative(process.cwd(), filePath).replaceAll('\\', '/');

  if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return relativePath;
  }

  return filePath.replaceAll('\\', '/');
}

function loadImportCache() {
  if (cli.noCache) {
    return { version: 1, updatedAt: '', files: {} };
  }

  const cache = readJsonFile(CACHE_FILE);

  if (!cache || typeof cache !== 'object') {
    return { version: 1, updatedAt: '', files: {} };
  }

  return {
    version: 1,
    updatedAt: cache.updatedAt || '',
    files: cache.files && typeof cache.files === 'object' ? cache.files : {},
  };
}

function saveImportCache(cache) {
  if (cli.noCache) return;

  cache.updatedAt = new Date().toISOString();
  writeJson(CACHE_FILE, cache);
}

function isPathInside(parentDir, childPath) {
  const relativePath = path.relative(parentDir, childPath);
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function copyZipFile(zip, entry, outPath) {
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, entry.getData());
}

function normalizeScreenshotPath(screenshotFile) {
  if (!screenshotFile) return '';
  return `screenshots/${path.basename(screenshotFile)}`;
}

function toPublicPath(relPath) {
  if (!relPath) return '';
  return `${currentPublicBase}/${relPath.replaceAll('\\', '/')}`;
}

function toPosixPath(value) {
  return String(value || '').replaceAll('\\', '/');
}

function toJsString(value) {
  return JSON.stringify(String(value || ''));
}

function safeFileName(value, fallback = 'item') {
  return String(value || fallback)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || fallback;
}

function toJsIdentifier(value, fallback = 'GeneratedPage') {
  const raw = String(value || fallback)
    .replace(/[^a-zA-Z0-9_$]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const safe = raw || fallback;

  if (/^[0-9]/.test(safe)) return `_${safe}`;

  return safe;
}

function unique(values) {
  const seen = new Set();
  const result = [];

  values.forEach((value) => {
    const text = String(value || '').trim();
    if (!text) return;

    const key = text.replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    result.push(text);
  });

  return result;
}

function deriveLessonTitleFromPageTitle(pageTitle) {
  const text = String(pageTitle || '').trim();

  if (!text) return 'Lesson';

  const match = text.match(/^(.+?)[_-]\d+$/);

  if (match?.[1]) return match[1];

  return text;
}

function getInputPartsFromZip(zipPath, sourceRoot = INPUT_DIR) {
  const pageTitle = path.basename(zipPath, path.extname(zipPath));
  const relativePath = path.relative(sourceRoot, zipPath).replaceAll('\\', '/');
  const isOutsideSourceRoot = !relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath);

  if (!isOutsideSourceRoot) {
    const parts = relativePath.split('/').filter(Boolean);

    if (parts.length >= 3) {
      return {
        courseTitle: parts[0],
        lessonTitle: parts[1],
        pageTitle,
      };
    }

    if (parts.length === 2) {
      return {
        courseTitle: parts[0],
        lessonTitle: deriveLessonTitleFromPageTitle(pageTitle),
        pageTitle,
      };
    }
  }

  const lessonTitle = path.basename(path.dirname(zipPath)) || deriveLessonTitleFromPageTitle(pageTitle);
  const courseTitle = path.basename(path.dirname(path.dirname(zipPath))) || 'Uncategorized';

  if (courseTitle && lessonTitle && courseTitle !== lessonTitle) {
    return {
      courseTitle,
      lessonTitle,
      pageTitle,
    };
  }

  return {
    courseTitle: 'Uncategorized',
    lessonTitle: deriveLessonTitleFromPageTitle(pageTitle),
    pageTitle,
  };
}

function getPublicBaseFromTargetRoot(targetRoot, courseId, lessonId, pageId) {
  const relativeToPublic = path.relative(PUBLIC_DIR, targetRoot).replaceAll('\\', '/');

  if (
    relativeToPublic &&
    relativeToPublic !== '.' &&
    !relativeToPublic.startsWith('..') &&
    !path.isAbsolute(relativeToPublic)
  ) {
    return `/${relativeToPublic}`;
  }

  return `/courses/${courseId}/${lessonId}/pages/${pageId}`;
}

function normalizeAssetPath(value) {
  if (!value) return value;

  const text = String(value).replaceAll('\\', '/');

  if (text.startsWith(`${currentPublicBase}/`)) return text;

  if (text.startsWith('/courses/current/')) {
    return `${currentPublicBase}/${text.slice('/courses/current/'.length)}`;
  }

  const courseAssetMatch = text.match(/^\/courses\/.+?\/(assets|screenshots|generated)\/(.+)$/);

  if (courseAssetMatch) {
    return `${currentPublicBase}/${courseAssetMatch[1]}/${courseAssetMatch[2]}`;
  }

  if (text.startsWith('assets/')) return toPublicPath(text);
  if (text.startsWith('screenshots/')) return toPublicPath(text);
  if (text.startsWith('generated/')) return toPublicPath(text);

  return value;
}

function deeplyNormalizePaths(value) {
  if (Array.isArray(value)) {
    return value.map(deeplyNormalizePaths);
  }

  if (value && typeof value === 'object') {
    const output = {};

    for (const [key, item] of Object.entries(value)) {
      if (
        typeof item === 'string' &&
        (
          key.toLowerCase().includes('src') ||
          key.toLowerCase().includes('url') ||
          key.toLowerCase().includes('path') ||
          key.toLowerCase().includes('file') ||
          key.toLowerCase().includes('image')
        )
      ) {
        output[key] = normalizeAssetPath(item);
      } else {
        output[key] = deeplyNormalizePaths(item);
      }
    }

    return output;
  }

  return value;
}

function inferRawActivityType(task) {
  return task.activityType || task.type || 'generic_captured_task';
}

function normalizeTask(task, taskIndex) {
  const normalizedTask = deeplyNormalizePaths(task);
  const activityType = inferRawActivityType(task);
  const taskId = task.taskId || task.id || `task-${taskIndex + 1}`;

  return {
    ...normalizedTask,

    id: taskId,
    taskId,
    title: task.title || task.name || `Activity ${taskIndex + 1}`,
    activityType,
    originalActivityType: task.activityType || '',

    states: (task.states || []).map((state, stateIndex) => {
      const normalizedState = deeplyNormalizePaths(state);
      const screenshotRel = normalizeScreenshotPath(state.screenshotFile);
      const stateId = state.stateId || state.id || `${taskId}-state-${stateIndex + 1}`;

      return {
        ...normalizedState,

        id: stateId,
        stateId,
        name: state.stateName || state.name || `state-${stateIndex + 1}`,
        stateName: state.stateName || state.name || `state-${stateIndex + 1}`,

        screenshot: toPublicPath(screenshotRel),
        screenshotFile: state.screenshotFile || '',
      };
    }),
  };
}

function normalizeManualActivityType(value, { allowEmpty = false } = {}) {
  const text = String(value || '').trim();

  if (!text && allowEmpty) return '';
  if (!text) return GENERIC_ACTIVITY_TYPE;

  return text;
}

function getSuggestedRendererType(rawActivityType) {
  const key = String(rawActivityType || '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_');

  return RAW_ACTIVITY_TYPE_SUGGESTIONS[key] || GENERIC_ACTIVITY_TYPE;
}

function getManualActivityMapPath(job) {
  return path.join(
    MANUAL_ACTIVITY_MAPS_ROOT,
    job.courseId,
    job.lessonId,
    `${job.pageId}.activity-map.json`,
  );
}

function readManualActivityMap(job) {
  return readJsonFile(getManualActivityMapPath(job));
}

function getTaskIdForMap(task, index = 0) {
  return String(task?.taskId || task?.id || `task-${index + 1}`);
}

function getStateIdForMap(state, index = 0) {
  return String(state?.stateId || state?.id || `state-${index + 1}`);
}

function buildManualActivityMap({ job, tasks, existingMap }) {
  const previousTasks = existingMap?.tasks && typeof existingMap.tasks === 'object'
    ? existingMap.tasks
    : {};

  const map = {
    version: 1,
    pageId: job.pageId,
    courseId: job.courseId,
    lessonId: job.lessonId,
    sourceZip: path.basename(job.zipPath),
    updatedAt: new Date().toISOString(),
    note: 'Edit selectedType. Leave a state selectedType empty to inherit the task selectedType. After editing, run npm run import again.',
    allowedTypes: MANUAL_ACTIVITY_TYPES,
    tasks: {},
  };

  tasks.forEach((task, taskIndex) => {
    const taskId = getTaskIdForMap(task, taskIndex);
    const oldTask = previousTasks[taskId] || {};
    const suggestedType = getSuggestedRendererType(task.activityType || task.originalActivityType);
    const selectedType = normalizeManualActivityType(oldTask.selectedType, { allowEmpty: true }) || GENERIC_ACTIVITY_TYPE;

    const taskEntry = {
      title: task.title || `Activity ${taskIndex + 1}`,
      rawActivityType: task.activityType || task.originalActivityType || '',
      suggestedType,
      selectedType,
      states: {},
    };

    const oldStates = oldTask.states && typeof oldTask.states === 'object'
      ? oldTask.states
      : {};

    const states = Array.isArray(task.states) ? task.states : [];

    states.forEach((state, stateIndex) => {
      const stateId = getStateIdForMap(state, stateIndex);
      const oldState = oldStates[stateId] || {};

      taskEntry.states[stateId] = {
        title: state.title || state.stateName || state.name || `state-${stateIndex + 1}`,
        selectedType: normalizeManualActivityType(oldState.selectedType, { allowEmpty: true }),
      };
    });

    map.tasks[taskId] = taskEntry;
  });

  return map;
}

function writeManualActivityMap(job, activityMap) {
  const filePath = getManualActivityMapPath(job);
  writeJson(filePath, activityMap);
  return filePath;
}

function getManualTaskConfig(activityMap, taskId) {
  return activityMap?.tasks?.[taskId] || null;
}

function getSelectedRendererType(activityMap, taskId, stateId) {
  const taskConfig = getManualTaskConfig(activityMap, taskId);
  const stateConfig = stateId ? taskConfig?.states?.[stateId] : null;
  const selectedStateType = normalizeManualActivityType(stateConfig?.selectedType, { allowEmpty: true });
  const selectedTaskType = normalizeManualActivityType(taskConfig?.selectedType, { allowEmpty: true });

  return selectedStateType || selectedTaskType || GENERIC_ACTIVITY_TYPE;
}

function getExpectedOutputPaths(job) {
  return {
    manifestPath: path.join(job.targetRoot, 'manifest.json'),
    pageInstancePath: path.join(job.targetRoot, 'page.instance.json'),
    generatedPagePath: path.join(getGeneratedPageDir(job), 'LessonPage.jsx'),
    manualActivityMapPath: getManualActivityMapPath(job),
  };
}

function shouldSkipJob(job, cache) {
  if (cli.force || cli.clean || cli.noCache) return false;

  const cacheRecord = cache.files[job.cacheKey];

  if (!cacheRecord || cacheRecord.sha256 !== job.sha256) return false;

  const expected = getExpectedOutputPaths(job);

  if (!(
    fs.existsSync(expected.manifestPath) &&
    fs.existsSync(expected.pageInstancePath) &&
    fs.existsSync(expected.generatedPagePath)
  )) {
    return false;
  }

  if (fs.existsSync(expected.manualActivityMapPath)) {
    const mapMtime = fs.statSync(expected.manualActivityMapPath).mtimeMs;
    const instanceMtime = fs.statSync(expected.pageInstancePath).mtimeMs;

    if (mapMtime > instanceMtime) {
      return false;
    }
  }

  return true;
}

function updateCacheForJob(cache, job, manifest) {
  cache.files[job.cacheKey] = {
    sha256: job.sha256,
    sourceZip: path.basename(job.zipPath),
    zipPath: job.zipPath.replaceAll('\\', '/'),
    courseId: job.courseId,
    lessonId: job.lessonId,
    pageId: job.pageId,
    output: job.targetRoot.replaceAll('\\', '/'),
    publicBase: job.publicBase,
    manualActivityMap: getManualActivityMapPath(job).replaceAll('\\', '/'),
    taskCount: manifest?.metadata?.taskCount || 0,
    stateCount: manifest?.metadata?.stateCount || 0,
    importedAt: manifest?.metadata?.importedAt || new Date().toISOString(),
  };
}

function removeDeletedInputFilesFromCache(cache, activeJobs) {
  const activeKeys = new Set(activeJobs.map((job) => job.cacheKey));

  for (const cacheKey of Object.keys(cache.files)) {
    if (activeKeys.has(cacheKey)) continue;
    delete cache.files[cacheKey];
  }
}

function rendererNormalize(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rendererLower(value) {
  return rendererNormalize(value).toLowerCase();
}

function uniqueRendererTexts(values) {
  const seen = new Set();
  const output = [];

  values.forEach((value) => {
    const text = rendererNormalize(value);
    const key = rendererLower(text);

    if (!text || seen.has(key)) return;

    seen.add(key);
    output.push(text);
  });

  return output;
}

function getLinesFromStateForRenderer(state) {
  if (!state) return [];

  const semanticBlocks = Array.isArray(state.semanticBlocks) ? state.semanticBlocks : [];

  if (semanticBlocks.length > 0) {
    const preferredKinds = [
      'question',
      'choice',
      'drag-card',
      'drop-zone',
      'code-line',
      'text',
      'action',
      'button',
    ];

    const lines = semanticBlocks
      .filter((block) => preferredKinds.includes(block.kind))
      .sort((a, b) => {
        const ay = Number(a?.rect?.y || 0);
        const by = Number(b?.rect?.y || 0);
        const ax = Number(a?.rect?.x || 0);
        const bx = Number(b?.rect?.x || 0);

        if (Math.abs(ay - by) > 8) return ay - by;
        return ax - bx;
      })
      .map((block) => rendererNormalize(block.text))
      .filter(Boolean);

    if (lines.length > 0) return uniqueRendererTexts(lines);
  }

  const arraySources = [
    state.textLines,
    state.visibleTextLines,
    state.lines,
    state.ocrTextLines,
    state.rawTextLines,
  ];

  for (const source of arraySources) {
    if (Array.isArray(source) && source.length > 0) {
      return source.map(rendererNormalize).filter(Boolean);
    }
  }

  const textSources = [
    state.instruction,
    state.bodyText,
    state.raw?.bodyText,
    state.text,
    state.visibleText,
    state.ocrText,
  ];

  for (const source of textSources) {
    if (!source) continue;

    const lines = String(source)
      .replace(/\u00a0/g, ' ')
      .split(/\r?\n/)
      .map(rendererNormalize)
      .filter(Boolean);

    if (lines.length > 0) return lines;
  }

  return [];
}

function isRendererNoiseLine(line) {
  const text = rendererNormalize(line);
  const lower = rendererLower(text);

  if (!text) return true;
  if (/^\d+$/.test(text)) return true;
  if (/^icon_\d+$/i.test(text)) return true;
  if (lower === 'part') return true;
  if (lower === 'attempt') return true;
  if (lower === 'answer') return true;
  if (lower === 'next') return true;
  if (lower === 'tasks will be checked by the teacher') return true;
  if (/^:\s*\d+\s*\/\s*\d+$/.test(text)) return true;

  return false;
}

function isRendererHelperLine(line) {
  const lower = rendererLower(line);

  return (
    lower.includes('there may be multiple correct answers') ||
    lower.includes('there may be more than one correct answer') ||
    lower.includes('pay attention') ||
    lower.includes('one name is extra') ||
    lower.includes('one name is superfluous')
  );
}

function rendererLineLooksLikeCode(line) {
  const text = rendererNormalize(line);
  const lower = rendererLower(text);

  if (/^print\s*\(/i.test(text)) return true;
  if (/^input\s*\(/i.test(text)) return true;
  if (/[(){}\[\]=:;"']/.test(text)) return true;

  return /\b(print|input|python|program|algorithm|data|name|surname|date|str|int|range|for|while|if|else|def|return)\b/.test(lower);
}

function rendererLineHasRepeatedWords(line) {
  const words = rendererLower(line).split(/\s+/).filter(Boolean);

  if (words.length < 2) return false;

  return new Set(words).size < words.length;
}

function getChoiceOptionsFromState(state) {
  const semanticChoices = Array.isArray(state?.semanticBlocks)
    ? state.semanticBlocks
        .filter((block) => block.kind === 'choice')
        .map((block, index) => ({
          id: `choice-${index + 1}`,
          text: rendererNormalize(block.text),
        }))
        .filter((item) => item.text)
    : [];

  if (semanticChoices.length > 0) return semanticChoices;

  const options = state?.choiceOptions || state?.choices || state?.options || [];

  if (!Array.isArray(options)) return [];

  return options
    .map((option, index) => {
      if (typeof option === 'string') {
        return {
          id: `option-${index + 1}`,
          text: rendererNormalize(option),
        };
      }

      return {
        id: String(option.id || option.value || `option-${index + 1}`),
        text: rendererNormalize(
          option.text ||
          option.label ||
          option.title ||
          option.value ||
          option.name ||
          '',
        ),
      };
    })
    .filter((option) => option.text);
}

function getTypingCandidateLines(task, state) {
  const stateLines = getLinesFromStateForRenderer(state);
  const allTaskLines = Array.isArray(task?.states)
    ? task.states.flatMap((item) => getLinesFromStateForRenderer(item))
    : [];

  return uniqueRendererTexts([...stateLines, ...allTaskLines].filter((line) => {
    const lower = rendererLower(line);

    if (isRendererNoiseLine(line)) return false;
    if (isRendererHelperLine(line)) return false;
    if (lower === "let's go!" || lower === "let's go") return false;
    if (lower === 'run the program') return false;
    if (lower === 'launch the program') return false;
    if (line.length > 160) return false;

    return rendererLineLooksLikeCode(line) || rendererLineHasRepeatedWords(line);
  }));
}

function buildMcqRendererForState(task, state) {
  const lines = getLinesFromStateForRenderer(state).filter((line) => !isRendererNoiseLine(line));
  const choiceOptions = getChoiceOptionsFromState(state);
  const optionLines = choiceOptions.map((option) => option.text).filter(Boolean);

  const prompt = lines.find((line) => {
    if (isRendererHelperLine(line)) return false;

    const lower = rendererLower(line);
    return !optionLines.some((option) => rendererLower(option) === lower);
  }) || task.title || 'Question';

  const helperText = lines.find((line) => isRendererHelperLine(line)) || '';
  const fallbackOptions = lines.filter((line) => {
    if (line === prompt) return false;
    if (isRendererHelperLine(line)) return false;
    if (isRendererNoiseLine(line)) return false;
    return true;
  });

  const options = uniqueRendererTexts(optionLines.length ? optionLines : fallbackOptions)
    .map((text, index) => ({
      id: `option-${index + 1}`,
      text,
      correct: false,
    }));

  return {
    type: 'mcq-checkbox',
    mcqCheckbox: {
      prompt,
      helperText,
      multiple: true,
      checkMode: 'visual-only',
      options,
    },
  };
}


function buildMatchingConnectRendererForState(task, state) {
  const images = Array.isArray(state?.images) ? state.images : [];
  const lines = getLinesFromStateForRenderer(state).filter((line) => {
    const lower = rendererLower(line);
    if (isRendererNoiseLine(line)) return false;
    if (lower === "let's go!") return false;
    return true;
  });

  const title = lines.find((line) => !isRendererHelperLine(line)) || task.title || 'Part 1. My correct solution';
  const helperText = lines.find((line) => isRendererHelperLine(line)) || 'Connect';
  const textOptions = lines.filter((line) => line !== title && line !== helperText);

  const leftItems = images.map((img, i) => ({
    id: `left-${i + 1}`,
    image: img.url || img.src || '',
    alt: img.alt || '',
  }));

  const rightItems = textOptions.map((text, i) => ({
    id: `right-${i + 1}`,
    text,
  }));

  return {
    type: 'matching-connect',
    matchingConnect: {
      title,
      helperText,
      attempt: 'Attempt: 1/2',
      checkMode: 'answer-key',
      leftItems,
      rightItems,
      answerKey: {},
    },
  };
}

function buildMatchingRendererForState(task, state) {
  const lines = getLinesFromStateForRenderer(state).filter((line) => {
    const lower = rendererLower(line);
    if (isRendererNoiseLine(line)) return false;
    if (lower === "let's go!") return false;
    return true;
  });

  const title = lines.find((line) => !isRendererHelperLine(line)) || task.title || 'Match the items';
  const helperText = lines.find((line) => isRendererHelperLine(line)) || '';
  const contentLines = lines.filter((line) => line !== title && line !== helperText);
  const itemLines = [];
  const targetLines = [];

  contentLines.forEach((line) => {
    const wordCount = line.split(/\s+/).filter(Boolean).length;

    if (line.endsWith('.') || wordCount >= 7) {
      targetLines.push(line);
    } else {
      itemLines.push(line);
    }
  });

  return {
    type: 'matching-dragdrop',
    matchingDragdrop: {
      title,
      helperText,
      checkMode: 'visual-only',
      items: uniqueRendererTexts(itemLines).map((text, index) => ({
        id: `item-${index + 1}`,
        text,
      })),
      targets: uniqueRendererTexts(targetLines).map((text, index) => ({
        id: `target-${index + 1}`,
        text,
      })),
    },
  };
}

function buildTypingRendererForState(task, state) {
  const allLines = getLinesFromStateForRenderer(state).filter((line) => !isRendererNoiseLine(line));
  const text = rendererLower(allLines.join(' '));
  const typingLines = getTypingCandidateLines(task, state);

  if (text.includes('type the text') && text.includes("let's go")) {
    return {
      type: 'typing-practice',
      typingPractice: {
        mode: 'intro',
        title: allLines.find((line) => rendererLower(line).includes('type the text')) || 'Type the text',
        description: allLines.find((line) => rendererLower(line).includes('typing speed')) || '',
        buttonText: "LET'S GO!",
        lines: typingLines,
      },
    };
  }

  return {
    type: 'typing-practice',
    typingPractice: {
      mode: 'typing',
      showLineNumbers: true,
      lines: typingLines,
    },
  };
}

function buildIdeRendererForState(task, state) {
  const lines = getLinesFromStateForRenderer(state);
  const codeFromInputs = Array.isArray(state?.inputs)
    ? state.inputs.map((input) => input.value || input.text || input.code || '').filter(Boolean)
    : [];
  const codeFromEditors = Array.isArray(state?.editors)
    ? state.editors.map((editor) => editor.value || editor.text || editor.code || '').filter(Boolean)
    : [];
  const codeFromBlocks = Array.isArray(state?.codeBlocks)
    ? state.codeBlocks.map((block) => block.code || block.text || block.value || '').filter(Boolean)
    : [];
  const codeFromLines = lines.filter((line) => rendererLineLooksLikeCode(line)).join('\n');

  const initialCode = codeFromInputs[0] || codeFromEditors[0] || codeFromBlocks[0] || codeFromLines || '';
  const prompt = lines
    .filter((line) => {
      const lower = rendererLower(line);
      if (isRendererNoiseLine(line)) return false;
      if (rendererLineLooksLikeCode(line)) return false;
      if (lower === 'run the program') return false;
      if (lower === 'launch the program') return false;
      if (lower === 'tasks will be checked by the teacher') return false;
      return true;
    })
    .join(' ');

  return {
    type: 'ide-programming',
    ideProgramming: {
      initialCode,
      prompt,
      checkMode: 'visual-only',
    },
  };
}

function buildDiagramRendererForState(task, state) {
  const lines = getLinesFromStateForRenderer(state).filter((line) => !isRendererNoiseLine(line));

  return {
    type: 'diagram-canvas-task',
    diagramCanvas: {
      title: task.title || state.title || lines[0] || 'Diagram activity',
      bodyLines: lines,
      checkMode: 'visual-only',
      diagramData: state?.diagramData || null,
      screenshotUrl: state?.screenshot || '',
    },
  };
}

function buildGenericRendererForState(task, state) {
  const lines = getLinesFromStateForRenderer(state).filter((line) => !isRendererNoiseLine(line));

  return {
    type: 'generic-captured-task',
    genericCaptured: {
      title: task.title || lines[0] || 'Captured task',
      bodyLines: lines,
      forceReplay: true,
      screenshotUrl: state?.screenshot || '',
    },
  };
}

function buildFillBlankRendererForState(task, state) {
  const lines = getLinesFromStateForRenderer(state).filter((line) => !isRendererNoiseLine(line));

  return {
    type: 'fill-blank-task',
    fillBlank: {
      title: task.title || lines[0] || 'Fill in the blank',
      bodyLines: lines,
      checkMode: 'visual-only',
      inputs: Array.isArray(state?.inputs) ? state.inputs : [],
    },
  };
}

function buildVideoRendererForState(task, state) {
  return {
    type: 'video-lesson',
    videoLesson: {
      title: task.title || state.title || 'Video lesson',
      iframes: Array.isArray(state?.iframes) ? state.iframes : [],
      videos: Array.isArray(state?.videos) ? state.videos : [],
      links: Array.isArray(state?.links) ? state.links : [],
      screenshotUrl: state?.screenshot || '',
    },
  };
}

function buildScratchRendererForState(task, state) {
  return {
    type: 'scratch-embed-task',
    scratchEmbed: {
      title: task.title || state.title || 'Scratch activity',
      iframes: Array.isArray(state?.iframes) ? state.iframes : [],
      links: Array.isArray(state?.links) ? state.links : [],
      screenshotUrl: state?.screenshot || '',
    },
  };
}

function buildRendererForStateByType(type, task, state) {
  const selectedType = normalizeManualActivityType(type);

  if (selectedType === 'matching-connect') return buildMatchingConnectRendererForState(task, state);
  if (selectedType === 'mcq-checkbox') return buildMcqRendererForState(task, state);
  if (selectedType === 'matching-dragdrop') return buildMatchingRendererForState(task, state);
  if (selectedType === 'typing-practice') return buildTypingRendererForState(task, state);
  if (selectedType === 'ide-programming') return buildIdeRendererForState(task, state);
  if (selectedType === 'diagram-canvas-task') return buildDiagramRendererForState(task, state);
  if (selectedType === 'fill-blank-task') return buildFillBlankRendererForState(task, state);
  if (selectedType === 'video-lesson') return buildVideoRendererForState(task, state);
  if (selectedType === 'scratch-embed-task') return buildScratchRendererForState(task, state);

  return buildGenericRendererForState(task, state);
}

function buildTaskRenderers(tasks, activityMap) {
  const output = {};

  tasks.forEach((task, taskIndex) => {
    const taskId = getTaskIdForMap(task, taskIndex);
    const states = Array.isArray(task.states) ? task.states : [];
    const taskSelectedType = getSelectedRendererType(activityMap, taskId, '');

    const stateRenderers = {};

    states.forEach((state, stateIndex) => {
      const stateId = getStateIdForMap(state, stateIndex);
      const stateSelectedType = getSelectedRendererType(activityMap, taskId, stateId);

      stateRenderers[stateId] = {
        type: stateSelectedType,
        manualSelectedType: stateSelectedType,
      };
    });

    output[taskId] = {
      type: taskSelectedType,
      manualSelectedType: taskSelectedType,
      states: stateRenderers,
    };
  });

  return output;
}

function buildPageInstance({ job, source, tasks, importedAt, stateCount, activityMap, activityMapPath }) {
  const taskRenderers = buildTaskRenderers(tasks, activityMap);

  return {
    schemaVersion: PAGE_INSTANCE_SCHEMA_VERSION,
    pageInstanceId: `${job.courseId}__${job.lessonId}__${job.pageId}`,
    createdAt: importedAt,
    importedAt,
    sourceZip: path.basename(job.zipPath),

    course: {
      id: job.courseId,
      title: job.courseTitle,
    },

    lesson: {
      id: job.lessonId,
      title: job.lessonTitle,
    },

    page: {
      id: job.pageId,
      title: job.pageTitle,
    },

    source: {
      version: source.version || '',
      runId: source.runId || '',
      createdAt: source.createdAt || '',
      updatedAt: source.updatedAt || '',
    },

    renderer: {
      version: RENDERER_VERSION,
      fallbackType: GENERIC_ACTIVITY_TYPE,
      source: 'manual-activity-map',
    },

    frameConfig: DEFAULT_FRAME_CONFIG,

    activityConfig: {
      manualMode: true,
      taskCount: tasks.length,
      stateCount,
      allowedTypes: MANUAL_ACTIVITY_TYPES,
      rawActivityTypes: unique(tasks.map((task) => task.activityType || '').filter(Boolean)),
    },

    manualActivityMap: {
      filePath: activityMapPath.replaceAll('\\', '/'),
      url: `/manual-activity-maps/${job.courseId}/${job.lessonId}/${job.pageId}.activity-map.json`,
      note: 'Edit selectedType in this file, then refresh the browser.',
    },

    manifest: `${job.publicBase}/manifest.json`,
    taskRenderers,

    tasks: tasks.map((task, taskIndex) => {
      const taskId = getTaskIdForMap(task, taskIndex);
      const taskConfig = getManualTaskConfig(activityMap, taskId) || {};
      const selectedType = getSelectedRendererType(activityMap, taskId, '');

      return {
        id: task.id,
        taskId: task.taskId,
        title: task.title,
        activityType: task.activityType,
        selectedType,
        suggestedType: taskConfig.suggestedType || GENERIC_ACTIVITY_TYPE,
        states: (task.states || []).map((state, stateIndex) => {
          const stateId = getStateIdForMap(state, stateIndex);

          return {
            id: state.id,
            stateId: state.stateId,
            name: state.name,
            stateName: state.stateName,
            selectedType: getSelectedRendererType(activityMap, taskId, stateId),
          };
        }),
      };
    }),
  };
}

function findZipFilesRecursively(dir) {
  if (!fs.existsSync(dir)) return [];

  const result = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      result.push(...findZipFilesRecursively(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) {
      result.push(fullPath);
    }
  }

  return result;
}

function makeZipJob(zipPath, customTargetRoot = '', sourceRoot = INPUT_DIR) {
  const { courseTitle, lessonTitle, pageTitle } = getInputPartsFromZip(zipPath, sourceRoot);
  const courseId = safeFileName(courseTitle, 'course');
  const lessonId = safeFileName(lessonTitle, 'lesson');
  const pageId = safeFileName(pageTitle, 'page');
  const targetRoot = customTargetRoot
    ? path.resolve(customTargetRoot)
    : path.join(COURSES_ROOT, courseId, lessonId, 'pages', pageId);

  return {
    zipPath,
    courseId,
    courseTitle,
    lessonId,
    lessonTitle,
    pageId,
    pageTitle,
    title: pageTitle,
    targetRoot,
    publicBase: getPublicBaseFromTargetRoot(targetRoot, courseId, lessonId, pageId),
    sourceRoot,
  };
}

function guessSourceRootForInput(inputPath) {
  const resolvedInput = path.resolve(inputPath || INPUT_DIR);

  if (!fs.existsSync(resolvedInput)) return INPUT_DIR;

  const stat = fs.statSync(resolvedInput);

  if (stat.isFile()) {
    if (isPathInside(INPUT_DIR, resolvedInput)) return INPUT_DIR;
    return path.dirname(path.dirname(path.dirname(resolvedInput)));
  }

  const inputName = path.basename(resolvedInput);
  const parentName = path.basename(path.dirname(resolvedInput));
  const grandParent = path.dirname(path.dirname(resolvedInput));
  const hasZipDirectly = fs.readdirSync(resolvedInput, { withFileTypes: true })
    .some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.zip'));

  if (resolvedInput === INPUT_DIR) return INPUT_DIR;
  if (hasZipDirectly && parentName) return grandParent;
  if (/^[A-Z0-9_-]+$/.test(inputName)) return path.dirname(resolvedInput);

  return resolvedInput;
}

function getZipJobs() {
  ensureDir(INPUT_DIR);
  ensureDir(COURSES_ROOT);
  ensureDir(GENERATED_PAGES_ROOT);
  ensureDir(MANUAL_ACTIVITY_MAPS_ROOT);

  if (rawInputPath) {
    const inputPath = path.resolve(rawInputPath);

    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input path not found: ${inputPath}`);
    }

    const stat = fs.statSync(inputPath);
    const sourceRoot = guessSourceRootForInput(inputPath);

    if (stat.isFile()) {
      if (!inputPath.toLowerCase().endsWith('.zip')) {
        throw new Error(`Input file must be a ZIP: ${inputPath}`);
      }

      return [makeZipJob(inputPath, rawTargetRoot, sourceRoot)];
    }

    if (stat.isDirectory()) {
      return findZipFilesRecursively(inputPath)
        .sort((a, b) => a.localeCompare(b))
        .map((zipPath) => makeZipJob(zipPath, '', sourceRoot));
    }
  }

  return findZipFilesRecursively(INPUT_DIR)
    .sort((a, b) => a.localeCompare(b))
    .map((zipPath) => makeZipJob(zipPath, '', INPUT_DIR));
}

function validateZipJob(job) {
  if (!fs.existsSync(job.zipPath)) {
    throw new Error(`ZIP file not found: ${job.zipPath}`);
  }

  if (!fs.statSync(job.zipPath).isFile()) {
    throw new Error(`ZIP path is not a file: ${job.zipPath}`);
  }
}

function buildGeneratedPageShellSource() {
  if (!fs.existsSync(GENERATED_PAGE_SHELL_TEMPLATE_PATH)) {
    throw new Error(
      `Missing GeneratedPageShell template: ${GENERATED_PAGE_SHELL_TEMPLATE_PATH}. ` +
      'Create src/templates/GeneratedPageShell.jsx first.',
    );
  }

  return fs.readFileSync(GENERATED_PAGE_SHELL_TEMPLATE_PATH, 'utf8');
}

function ensureGeneratedPageShell() {
  ensureDir(GENERATED_PAGES_ROOT);

  const shellPath = path.join(GENERATED_PAGES_ROOT, 'GeneratedPageShell.jsx');
  const source = buildGeneratedPageShellSource();

  fs.writeFileSync(shellPath, source, 'utf8');
  console.log(`Generated page shell: ${shellPath}`);
}

function buildGeneratedPageSource(job) {
  const manifestUrl = `${job.publicBase}/manifest.json`;
  const pageInstanceUrl = `${job.publicBase}/page.instance.json`;

  return `import GeneratedPageShell from '../../../GeneratedPageShell.jsx';

export default function LessonPage({
  courseId,
  lessonId,
  pageId,
  onBackToPages,
}) {
  return (
    <GeneratedPageShell
      manifestUrl=${toJsString(manifestUrl)}
      pageInstanceUrl=${toJsString(pageInstanceUrl)}
      courseId={courseId}
      lessonId={lessonId}
      pageId={pageId}
      onBackToPages={onBackToPages}
    />
  );
}
`;
}

function getGeneratedPageDir(job) {
  return path.join(GENERATED_PAGES_ROOT, job.courseId, job.lessonId, job.pageId);
}

function ensureGeneratedPage(job) {
  ensureGeneratedPageShell();

  const pageDir = getGeneratedPageDir(job);
  ensureDir(pageDir);

  const pagePath = path.join(pageDir, 'LessonPage.jsx');
  const cssPath = path.join(pageDir, 'lesson.css');

  if (!fs.existsSync(pagePath)) {
    fs.writeFileSync(pagePath, buildGeneratedPageSource(job));
    console.log(`Generated React page: ${pagePath}`);
  } else {
    console.log(`Keep existing React page: ${pagePath}`);
  }

  if (!fs.existsSync(cssPath)) {
    fs.writeFileSync(cssPath, '/* Page-specific CSS for this generated page. */\n');
    console.log(`Generated page CSS: ${cssPath}`);
  }
}

function findGeneratedPages() {
  if (!fs.existsSync(GENERATED_PAGES_ROOT)) return [];

  const result = [];

  for (const courseEntry of fs.readdirSync(GENERATED_PAGES_ROOT, { withFileTypes: true })) {
    if (!courseEntry.isDirectory()) continue;

    const courseId = courseEntry.name;
    const courseDir = path.join(GENERATED_PAGES_ROOT, courseId);

    for (const lessonEntry of fs.readdirSync(courseDir, { withFileTypes: true })) {
      if (!lessonEntry.isDirectory()) continue;

      const lessonId = lessonEntry.name;
      const lessonDir = path.join(courseDir, lessonId);

      for (const pageEntry of fs.readdirSync(lessonDir, { withFileTypes: true })) {
        if (!pageEntry.isDirectory()) continue;

        const pageId = pageEntry.name;
        const pagePath = path.join(lessonDir, pageId, 'LessonPage.jsx');

        if (!fs.existsSync(pagePath)) continue;

        result.push({
          courseId,
          lessonId,
          pageId,
          pagePath,
          importPath: `./${courseId}/${lessonId}/${pageId}/LessonPage.jsx`,
        });
      }
    }
  }

  return result.sort((a, b) => {
    return `${a.courseId}/${a.lessonId}/${a.pageId}`.localeCompare(`${b.courseId}/${b.lessonId}/${b.pageId}`);
  });
}

function buildGeneratedPagesRegistry() {
  ensureDir(GENERATED_PAGES_ROOT);

  const pages = findGeneratedPages();
  const imports = pages.map((page, index) => {
    const importName = toJsIdentifier(`Generated_${page.courseId}_${page.lessonId}_${page.pageId}_${index}`);

    return {
      ...page,
      importName,
      line: `import ${importName} from ${toJsString(toPosixPath(page.importPath))};`,
    };
  });

  const registryEntries = imports.map((page) => {
    const key = `${page.courseId}/${page.lessonId}/${page.pageId}`;
    return `  ${toJsString(key)}: ${page.importName},`;
  });

  const source = `${imports.map((item) => item.line).join('\n')}

const generatedPageRegistry = {
${registryEntries.join('\n')}
};

export default generatedPageRegistry;
`;

  fs.writeFileSync(path.join(GENERATED_PAGES_ROOT, 'registry.js'), source);
  console.log(`Updated generated page registry: ${path.join(GENERATED_PAGES_ROOT, 'registry.js')}`);
  console.log(`Generated pages: ${pages.length}`);
}

async function importZipPage(job) {
  validateZipJob(job);

  currentPublicBase = job.publicBase;

  console.log('');
  console.log(`Reading ZIP: ${job.zipPath}`);
  console.log(`Course ID: ${job.courseId}`);
  console.log(`Lesson ID: ${job.lessonId}`);
  console.log(`Page ID: ${job.pageId}`);
  console.log(`Output folder: ${job.targetRoot}`);
  console.log(`Public base: ${currentPublicBase}`);

  const zipBuffer = fs.readFileSync(job.zipPath);
  const zip = new AdmZip(zipBuffer);
  const exportEntry =
    zip.getEntry('lms-template-capture-export.json') ||
    zip.getEntry('lms-template-capture-export');

  if (!exportEntry) {
    throw new Error(`Missing lms-template-capture-export.json in ZIP: ${job.zipPath}`);
  }

  cleanDir(job.targetRoot);

  for (const entry of zip.getEntries()) {
    const name = entry.entryName;

    if (entry.isDirectory) continue;

    if (
      name.startsWith('screenshots/') ||
      name.startsWith('assets/') ||
      name.startsWith('generated/') ||
      name === 'activity-inventory.csv' ||
      name === 'click-audit.csv'
    ) {
      copyZipFile(zip, entry, path.join(job.targetRoot, name));
    }
  }

  const source = JSON.parse(exportEntry.getData().toString('utf8'));
  const tasks = (source.tasks || []).map(normalizeTask);
  const stateCount = tasks.reduce((total, task) => {
    return total + (Array.isArray(task.states) ? task.states.length : 0);
  }, 0);
  const importedAt = new Date().toISOString();

  const existingActivityMap = readManualActivityMap(job);
  const activityMap = buildManualActivityMap({
    job,
    tasks,
    existingMap: existingActivityMap,
  });
  const activityMapPath = writeManualActivityMap(job, activityMap);

  const manifest = {
    metadata: {
      courseId: job.courseId,
      courseTitle: job.courseTitle,
      lessonId: job.lessonId,
      lessonTitle: job.lessonTitle,
      pageId: job.pageId,
      pageTitle: job.pageTitle,
      title: job.pageTitle,
      publicBase: job.publicBase,
      sourceZip: path.basename(job.zipPath),
      version: source.version,
      runId: source.runId,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      importedAt,
      taskCount: tasks.length,
      stateCount,
      pageInstance: `${job.publicBase}/page.instance.json`,
      manualActivityMap: activityMapPath.replaceAll('\\', '/'),
      generatedPageKey: `${job.courseId}/${job.lessonId}/${job.pageId}`,
      generatedPageDir: `src/generated-pages/${job.courseId}/${job.lessonId}/${job.pageId}`,
      rendererVersion: RENDERER_VERSION,
      notes: source.notes || [],
    },
    tasks,
  };

  const pageInstance = buildPageInstance({
    job,
    source,
    tasks,
    importedAt,
    stateCount,
    activityMap,
    activityMapPath,
  });

  writeJson(path.join(job.targetRoot, 'manifest.json'), manifest);
  writeJson(path.join(job.targetRoot, 'page.instance.json'), pageInstance);

  ensureGeneratedPage(job);

  console.log(`Manual activity map: ${activityMapPath}`);
  console.log(`Imported ${tasks.length} tasks / ${stateCount} states into ${job.targetRoot}`);

  return manifest;
}

function getPageStats(manifest) {
  const metadata = manifest?.metadata || {};
  const tasks = Array.isArray(manifest?.tasks) ? manifest.tasks : [];
  const taskCount = Number.isFinite(metadata.taskCount)
    ? metadata.taskCount
    : tasks.length;
  const stateCount = Number.isFinite(metadata.stateCount)
    ? metadata.stateCount
    : tasks.reduce((total, task) => {
      return total + (Array.isArray(task.states) ? task.states.length : 0);
    }, 0);

  return {
    taskCount,
    stateCount,
  };
}

function buildPageCatalogForLesson(courseId, lessonId, lessonDir) {
  const pagesRoot = path.join(lessonDir, 'pages');

  if (!fs.existsSync(pagesRoot)) return null;

  const pageEntries = fs.readdirSync(pagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const pageId = entry.name;
      const pageDir = path.join(pagesRoot, pageId);
      const manifestPath = path.join(pageDir, 'manifest.json');
      const pageInstancePath = path.join(pageDir, 'page.instance.json');

      if (!fs.existsSync(manifestPath)) return null;

      const manifest = readJsonFile(manifestPath);
      const metadata = manifest?.metadata || {};
      const stats = getPageStats(manifest);

      return {
        id: pageId,
        pageId,
        title: metadata.pageTitle || metadata.title || pageId,
        courseId: metadata.courseId || courseId,
        courseTitle: metadata.courseTitle || courseId,
        lessonId: metadata.lessonId || lessonId,
        lessonTitle: metadata.lessonTitle || lessonId,
        sourceZip: metadata.sourceZip || '',
        taskCount: stats.taskCount,
        stateCount: stats.stateCount,
        createdAt: metadata.createdAt || '',
        updatedAt: metadata.updatedAt || '',
        importedAt: metadata.importedAt || '',
        rendererVersion: metadata.rendererVersion || '',
        manualActivityMap: metadata.manualActivityMap || '',
        generatedPageKey: `${courseId}/${lessonId}/${pageId}`,
        generatedPageDir: `src/generated-pages/${courseId}/${lessonId}/${pageId}`,
        manifest: `/courses/${courseId}/${lessonId}/pages/${pageId}/manifest.json`,
        instance: fs.existsSync(pageInstancePath)
          ? `/courses/${courseId}/${lessonId}/pages/${pageId}/page.instance.json`
          : '',
        pageInstance: fs.existsSync(pageInstancePath)
          ? `/courses/${courseId}/${lessonId}/pages/${pageId}/page.instance.json`
          : '',
        href: `/?course=${encodeURIComponent(courseId)}&lesson=${encodeURIComponent(lessonId)}&page=${encodeURIComponent(pageId)}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title));

  if (!pageEntries.length) return null;

  const lessonTitle = pageEntries[0]?.lessonTitle || lessonId;
  const courseTitle = pageEntries[0]?.courseTitle || courseId;
  const taskCount = pageEntries.reduce((total, page) => total + page.taskCount, 0);
  const stateCount = pageEntries.reduce((total, page) => total + page.stateCount, 0);
  const pageCatalog = {
    id: lessonId,
    lessonId,
    title: lessonTitle,
    courseId,
    courseTitle,
    generatedAt: new Date().toISOString(),
    pageCount: pageEntries.length,
    taskCount,
    stateCount,
    pages: pageEntries,
  };

  writeJson(path.join(lessonDir, 'index.json'), pageCatalog);

  return pageCatalog;
}

function buildLessonCatalogForCourse(courseDir, courseId) {
  const lessonEntries = fs.readdirSync(courseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const lessonId = entry.name;
      const lessonDir = path.join(courseDir, lessonId);
      const pageCatalog = buildPageCatalogForLesson(courseId, lessonId, lessonDir);

      if (!pageCatalog) return null;

      return {
        id: lessonId,
        lessonId,
        title: pageCatalog.title || lessonId,
        courseId,
        courseTitle: pageCatalog.courseTitle || courseId,
        pageCount: pageCatalog.pageCount,
        taskCount: pageCatalog.taskCount,
        stateCount: pageCatalog.stateCount,
        index: `/courses/${courseId}/${lessonId}/index.json`,
        href: `/?course=${encodeURIComponent(courseId)}&lesson=${encodeURIComponent(lessonId)}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title));

  if (!lessonEntries.length) return null;

  const courseTitle = lessonEntries[0]?.courseTitle || courseId;
  const pageCount = lessonEntries.reduce((total, lesson) => total + lesson.pageCount, 0);
  const taskCount = lessonEntries.reduce((total, lesson) => total + lesson.taskCount, 0);
  const stateCount = lessonEntries.reduce((total, lesson) => total + lesson.stateCount, 0);
  const lessonCatalog = {
    id: courseId,
    title: courseTitle,
    generatedAt: new Date().toISOString(),
    lessonCount: lessonEntries.length,
    pageCount,
    taskCount,
    stateCount,
    lessons: lessonEntries,
  };

  writeJson(path.join(courseDir, 'index.json'), lessonCatalog);

  return lessonCatalog;
}

function buildCourseCatalog() {
  ensureDir(COURSES_ROOT);

  const courseEntries = fs.readdirSync(COURSES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const courseId = entry.name;
      const courseDir = path.join(COURSES_ROOT, courseId);
      const lessonCatalog = buildLessonCatalogForCourse(courseDir, courseId);

      if (!lessonCatalog) return null;

      return {
        id: courseId,
        title: lessonCatalog.title || courseId,
        lessonCount: lessonCatalog.lessonCount,
        pageCount: lessonCatalog.pageCount,
        taskCount: lessonCatalog.taskCount,
        stateCount: lessonCatalog.stateCount,
        index: `/courses/${courseId}/index.json`,
        href: `/?course=${encodeURIComponent(courseId)}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title));

  const catalog = {
    generatedAt: new Date().toISOString(),
    count: courseEntries.length,
    courses: courseEntries,
  };

  writeJson(path.join(COURSES_ROOT, 'index.json'), catalog);

  console.log('');
  console.log(`Updated course catalog: ${path.join(COURSES_ROOT, 'index.json')}`);
  console.log(`Courses: ${courseEntries.length}`);

  courseEntries.forEach((course, index) => {
    console.log(`${index + 1}. ${course.id} - ${course.lessonCount} lessons / ${course.pageCount} pages / ${course.taskCount} tasks / ${course.stateCount} states`);
  });

  return catalog;
}

async function runImportOnce() {
  if (cli.clean) {
    console.log('');
    console.log('Cleaning generated output...');
    cleanDir(COURSES_ROOT);
    cleanDir(GENERATED_PAGES_ROOT);
    console.log(`Manual activity maps are preserved in: ${MANUAL_ACTIVITY_MAPS_ROOT}`);
  }

  ensureDir(MANUAL_ACTIVITY_MAPS_ROOT);

  const cache = loadImportCache();
  const jobs = getZipJobs().map((job) => ({
    ...job,
    cacheKey: getCacheKey(job.zipPath),
    sha256: hashFile(job.zipPath),
  }));

  const stats = {
    imported: 0,
    skipped: 0,
    failed: 0,
  };

  if (!jobs.length) {
    console.log('');
    console.log('No ZIP files found.');
    console.log('Rebuilding catalogs and generated page registry from existing output...');
  }

  removeDeletedInputFilesFromCache(cache, jobs);

  for (const job of jobs) {
    try {
      if (shouldSkipJob(job, cache)) {
        stats.skipped += 1;
        console.log(`Skip unchanged: ${job.cacheKey}`);
        continue;
      }

      const manifest = await importZipPage(job);
      updateCacheForJob(cache, job, manifest);
      stats.imported += 1;
    } catch (err) {
      stats.failed += 1;
      console.error('');
      console.error(`FAILED: ${job.zipPath}`);
      console.error(err?.stack || err?.message || String(err));
    }
  }

  ensureGeneratedPageShell();
  buildCourseCatalog();
  buildGeneratedPagesRegistry();
  saveImportCache(cache);

  console.log('');
  console.log('Import summary:');
  console.log(`  Imported/updated: ${stats.imported}`);
  console.log(`  Skipped unchanged: ${stats.skipped}`);
  console.log(`  Failed: ${stats.failed}`);
  console.log('');
  console.log('Done.');
  console.log('Manual activity maps folder:');
  console.log(`  ${MANUAL_ACTIVITY_MAPS_ROOT}`);
  console.log('Edit selectedType in the activity-map.json file, then run import again.');
  console.log('');

  return stats;
}

function watchInputAndImport() {
  let timer = null;
  let isRunning = false;
  let pending = false;

  async function scheduleRun(reason = 'change') {
    if (timer) clearTimeout(timer);

    timer = setTimeout(async () => {
      if (isRunning) {
        pending = true;
        return;
      }

      isRunning = true;
      pending = false;

      console.log('');
      console.log(`Detected input ${reason}. Running incremental import...`);

      try {
        await runImportOnce();
      } finally {
        isRunning = false;

        if (pending) {
          scheduleRun('change while import was running');
        }
      }
    }, 800);
  }

  const watchPath = rawInputPath ? path.resolve(rawInputPath) : INPUT_DIR;

  ensureDir(watchPath);

  console.log('');
  console.log(`Watching for ZIP changes in: ${watchPath}`);
  console.log('Press Ctrl+C to stop.');

  fs.watch(watchPath, { recursive: true }, (_eventType, filename) => {
    if (!filename) return;
    if (!String(filename).toLowerCase().endsWith('.zip')) return;
    scheduleRun(String(filename));
  });
}

await runImportOnce();

if (cli.watch) {
  watchInputAndImport();
}