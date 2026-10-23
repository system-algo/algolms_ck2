import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

const INPUT_DIR = path.resolve('input');
const COURSES_ROOT = path.resolve('public/courses');
const GENERATED_PAGES_ROOT = path.resolve('src/generated-pages');
const IMPORTABLE_EXTENSIONS = new Set(['.h5p', '.zip']);

function parseCliArgs(argv) {
  const options = {
    watch: false,
    clean: false,
    help: false,
    positional: [],
  };

  for (const arg of argv) {
    if (arg === '--watch' || arg === '-w') options.watch = true;
    else if (arg === '--clean') options.clean = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    // Keep these accepted for compatibility with the existing package.json.
    else if (arg === '--force' || arg === '-f' || arg === '--no-cache') {
      // No action is required. Imports always overwrite the selected page.
    } else {
      options.positional.push(arg);
    }
  }

  return options;
}

const cli = parseCliArgs(process.argv.slice(2));
const rawInputPath = cli.positional[0] || '';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function parseJsonBuffer(buffer, label) {
  let text;

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    text = buffer.subarray(2).toString('utf16le');
  } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(buffer.length - 2);
    for (let i = 2; i + 1 < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1];
      swapped[i - 1] = buffer[i];
    }
    text = swapped.toString('utf16le');
  } else {
    text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${error.message}`);
  }
}

function toJsIdentifier(value) {
  const identifier = String(value || 'Page')
    .replace(/[^a-zA-Z0-9_$]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return identifier || 'Page';
}

function safeFileName(value) {
  return String(value || 'item')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function positiveInteger(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(1, Math.trunc(parsed))
    : fallback;
}

/**
 * The VP player splits H5P.SingleChoiceSet into one LMS task per question.
 * Every other H5P activity is currently tracked as one LMS task.
 */
function getH5pTaskCount(h5pData, contentData) {
  const mainLibrary = String(h5pData?.mainLibrary || '').trim();

  if (mainLibrary === 'H5P.SingleChoiceSet') {
    const choices = Array.isArray(contentData?.choices)
      ? contentData.choices
      : [];

    return Math.max(1, choices.length);
  }

  return 1;
}

function getInputPartsFromArchive(h5pPath) {
  const sourceName = path.basename(h5pPath, path.extname(h5pPath));
  let courseTitle = 'VP';
  let lessonTitle = sourceName;
  let parsedPageId = sourceName;

  const match =
    sourceName.match(/(?:VP[\s_-]*)?(M\d+L\d+(?:_\d+)?)/i) ||
    sourceName.match(/(?:VP[\s_-]*)?(M\d+)/i);

  if (match) {
    const moduleMatch = sourceName.match(/M(\d+)/i);
    const moduleNumber = moduleMatch ? moduleMatch[1] : '1';

    const moduleMap = {
      1: 'M1-Visual-Programming-Basics',
      2: 'M2-Control-Structures',
      3: 'M3-Functions-and-Modules',
      4: 'M4-Math-and-Logic',
      5: 'M5-Game-Development',
      6: 'M6-Advanced-Projects',
      7: 'M7-Hackathon-Series',
    };

    lessonTitle = moduleMap[moduleNumber] || `M${moduleNumber}-Module`;
    parsedPageId = `VP_${match[1].toUpperCase()}`;
  } else {
    parsedPageId = sourceName.toUpperCase().startsWith('VP')
      ? sourceName
      : `VP_${sourceName}`;
  }

  return {
    courseTitle,
    lessonTitle,
    pageTitle: parsedPageId,
  };
}

function readArchiveJson(archive, entryName, required = false) {
  const entry = archive.getEntry(entryName);

  if (!entry) {
    if (required) {
      throw new Error(`Missing ${entryName} in the H5P package.`);
    }
    return {};
  }

  return parseJsonBuffer(entry.getData(), entryName);
}

function getGeneratedPageDir(job) {
  return path.join(
    GENERATED_PAGES_ROOT,
    job.courseId,
    job.lessonId,
    job.pageId,
  );
}

function generateReactShell(job, title, taskCount) {
  const dir = getGeneratedPageDir(job);
  ensureDir(dir);

  const componentName = toJsIdentifier(job.pageId);
  const code = `import React from 'react';
import H5pPlayerPage from '../../../../pages/H5pPlayerPage';

export default function ${componentName}() {
  const activity = {
    id: ${JSON.stringify(job.pageId)},
    title: ${JSON.stringify(title)},
    taskCount: ${taskCount},
    h5pPlayUrl: ${JSON.stringify(`${job.publicBase}/workspace`)},
    moduleId: ${JSON.stringify(job.lessonId)},
  };

  return (
    <H5pPlayerPage
      activity={activity}
      courseId=${JSON.stringify(job.courseId)}
      onBack={() => window.history.back()}
    />
  );
}
`;

  fs.writeFileSync(path.join(dir, 'LessonPage.jsx'), code, 'utf8');
}

function generateGoogleSlidesReactShell(job, title, embedUrl) {
  const dir = getGeneratedPageDir(job);
  ensureDir(dir);

  const componentName = toJsIdentifier(job.pageId);
  const code = `import React from 'react';
import GoogleSlidesPlayerPage from '../../../../pages/GoogleSlidesPlayerPage';

export default function ${componentName}() {
  const activity = {
    id: ${JSON.stringify(job.pageId)},
    title: ${JSON.stringify(title)},
    taskCount: 1,
    embedUrl: ${JSON.stringify(embedUrl)},
    moduleId: ${JSON.stringify(job.lessonId)},
  };

  return (
    <GoogleSlidesPlayerPage
      activity={activity}
      courseId=${JSON.stringify(job.courseId)}
      onBack={() => window.history.back()}
    />
  );
}
`;

  fs.writeFileSync(path.join(dir, 'LessonPage.jsx'), code, 'utf8');
}

function processGoogleSlides(job, url) {
  console.log(`\nProcessing Google Slides: ${job.pageTitle}`);

  // Extract presentation ID from the URL or use as is
  let embedUrl = '';
  const match = url.match(/\/presentation\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    embedUrl = `https://docs.google.com/presentation/d/${match[1]}/embed?start=false&loop=false&delayms=3000`;
  } else {
    embedUrl = url;
  }

  const title = job.pageTitle;
  const workspacePath = path.join(job.targetRoot, 'workspace');
  cleanDir(workspacePath);

  // Write content to a text file in workspace as reference
  fs.writeFileSync(path.join(workspacePath, 'slides.txt'), url, 'utf8');

  const manifest = {
    version: 1,
    id: job.pageId,
    title,
    type: 'google-slides',
    taskCount: 1,
    metadata: {
      courseId: job.courseId,
      lessonId: job.lessonId,
      sourceLink: url,
      importedAt: new Date().toISOString(),
    },
  };

  writeJson(path.join(job.targetRoot, 'manifest.json'), manifest);

  const pageInstance = {
    schemaVersion: 2,
    id: job.pageId,
    title,
    type: 'google-slides',
    taskCount: 1,
    embedUrl: embedUrl,
  };

  writeJson(
    path.join(job.targetRoot, 'page.instance.json'),
    pageInstance,
  );

  generateGoogleSlidesReactShell(job, title, embedUrl);

  return manifest;
}

function processH5p(job) {
  console.log(`\nReading H5P: ${job.h5pPath}`);

  const archive = new AdmZip(job.h5pPath);
  const h5pData = readArchiveJson(archive, 'h5p.json', true);
  const contentData = readArchiveJson(
    archive,
    'content/content.json',
    false,
  );

  const title = h5pData.title || job.pageTitle;
  const taskCount = getH5pTaskCount(h5pData, contentData);

  const workspacePath = path.join(job.targetRoot, 'workspace');
  cleanDir(workspacePath);
  archive.extractAllTo(workspacePath, true);

  const manifest = {
    version: 1,
    id: job.pageId,
    title,
    type: 'h5p-standalone',
    taskCount,
    metadata: {
      courseId: job.courseId,
      lessonId: job.lessonId,
      sourceH5p: path.basename(job.h5pPath),
      importedAt: new Date().toISOString(),
    },
  };

  writeJson(path.join(job.targetRoot, 'manifest.json'), manifest);

  const pageInstance = {
    schemaVersion: 2,
    id: job.pageId,
    title,
    type: 'h5p-standalone',
    taskCount,
    h5pPlayUrl: `${job.publicBase}/workspace`,
  };

  writeJson(
    path.join(job.targetRoot, 'page.instance.json'),
    pageInstance,
  );

  generateReactShell(job, title, taskCount);

  return manifest;
}

function isImportableFile(filePath) {
  return IMPORTABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function findH5pFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      findH5pFiles(fullPath, fileList);
    } else if (entry.isFile() && isImportableFile(fullPath)) {
      fileList.push(fullPath);
    }
  }

  return fileList;
}

function loadExistingCourses() {
  const globalIndex = readJsonFile(path.join(COURSES_ROOT, 'index.json'));

  if (Array.isArray(globalIndex?.courses)) {
    return globalIndex.courses;
  }

  if (!fs.existsSync(COURSES_ROOT)) return [];

  const courses = [];

  for (const entry of fs.readdirSync(COURSES_ROOT, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const course = readJsonFile(
      path.join(COURSES_ROOT, entry.name, 'index.json'),
    );

    if (course?.id) courses.push(course);
  }

  return courses;
}

function ensureCourse(courses, courseId, courseTitle = courseId) {
  let course = courses.find((item) => item.id === courseId);

  if (!course) {
    course = {
      id: courseId,
      title: courseTitle,
      lessons: [],
    };
    courses.push(course);
  }

  if (!Array.isArray(course.lessons)) course.lessons = [];
  if (!course.title) course.title = courseTitle;

  return course;
}

function ensureLesson(course, lessonId, lessonTitle = lessonId) {
  let lesson = course.lessons.find((item) => item.id === lessonId);

  if (!lesson) {
    lesson = {
      id: lessonId,
      title: lessonTitle,
      pages: [],
    };
    course.lessons.push(lesson);
  }

  if (!Array.isArray(lesson.pages)) lesson.pages = [];
  if (!lesson.title) lesson.title = lessonTitle;

  return lesson;
}

function upsertPage(courses, details) {
  const course = ensureCourse(
    courses,
    details.courseId,
    details.courseTitle,
  );
  const lesson = ensureLesson(
    course,
    details.lessonId,
    details.lessonTitle,
  );

  const pageIndex = lesson.pages.findIndex(
    (page) => page.id === details.page.id,
  );

  if (pageIndex >= 0) {
    lesson.pages[pageIndex] = {
      ...lesson.pages[pageIndex],
      ...details.page,
    };
  } else {
    lesson.pages.push(details.page);
  }
}

function getTaskCountFromGeneratedPage(courseId, lessonId, pageId) {
  const pageRoot = path.join(
    COURSES_ROOT,
    courseId,
    lessonId,
    'pages',
    pageId,
  );
  const workspaceRoot = path.join(pageRoot, 'workspace');

  const h5pData = readJsonFile(path.join(workspaceRoot, 'h5p.json'));
  if (h5pData) {
    const contentData =
      readJsonFile(path.join(workspaceRoot, 'content', 'content.json')) || {};
    return getH5pTaskCount(h5pData, contentData);
  }

  const manifest = readJsonFile(path.join(pageRoot, 'manifest.json'));
  if (manifest?.taskCount) {
    return positiveInteger(manifest.taskCount);
  }

  const pageInstance = readJsonFile(
    path.join(pageRoot, 'page.instance.json'),
  );
  if (pageInstance?.taskCount) {
    return positiveInteger(pageInstance.taskCount);
  }

  return null;
}

/**
 * Recover any generated public page that exists on disk but is missing from
 * an older index.json. This makes one-file imports safe and prevents the
 * importer from deleting existing catalog entries.
 */
function discoverGeneratedPublicPages(courses) {
  if (!fs.existsSync(COURSES_ROOT)) return;

  for (const courseEntry of fs.readdirSync(COURSES_ROOT, {
    withFileTypes: true,
  })) {
    if (!courseEntry.isDirectory() || courseEntry.name.startsWith('.')) {
      continue;
    }

    const courseId = courseEntry.name;
    const course = ensureCourse(courses, courseId, courseId);
    const courseRoot = path.join(COURSES_ROOT, courseId);

    for (const lessonEntry of fs.readdirSync(courseRoot, {
      withFileTypes: true,
    })) {
      if (!lessonEntry.isDirectory() || lessonEntry.name === 'pages') {
        continue;
      }

      const lessonId = lessonEntry.name;
      const pagesRoot = path.join(courseRoot, lessonId, 'pages');
      if (!fs.existsSync(pagesRoot)) continue;

      const lesson = ensureLesson(course, lessonId, lessonId);

      for (const pageEntry of fs.readdirSync(pagesRoot, {
        withFileTypes: true,
      })) {
        if (!pageEntry.isDirectory()) continue;

        const pageId = pageEntry.name;
        if (lesson.pages.some((page) => page.id === pageId)) continue;

        const pageRoot = path.join(pagesRoot, pageId);
        const manifest = readJsonFile(path.join(pageRoot, 'manifest.json'));
        const pageInstance = readJsonFile(
          path.join(pageRoot, 'page.instance.json'),
        );

        lesson.pages.push({
          id: pageId,
          title:
            manifest?.title ||
            pageInstance?.title ||
            pageId,
          taskCount:
            getTaskCountFromGeneratedPage(courseId, lessonId, pageId) || 1,
        });
      }
    }
  }
}

function normalizeCourses(courses) {
  return courses.map((course) => {
    const lessons = (Array.isArray(course.lessons) ? course.lessons : []).map(
      (lesson) => {
        const pages = (Array.isArray(lesson.pages) ? lesson.pages : [])
          .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }))
          .map(
          (page) => {
            const detectedTaskCount = getTaskCountFromGeneratedPage(
              course.id,
              lesson.id,
              page.id,
            );

            return {
              ...page,
              taskCount:
                detectedTaskCount || positiveInteger(page.taskCount, 1),
            };
          },
        );

        return {
          ...lesson,
          pages,
          pageCount: pages.length,
          taskCount: pages.reduce(
            (sum, page) => sum + positiveInteger(page.taskCount, 1),
            0,
          ),
        };
      },
    );

    return {
      ...course,
      lessons,
      pageCount: lessons.reduce(
        (sum, lesson) => sum + positiveInteger(lesson.pageCount, 0),
        0,
      ),
      taskCount: lessons.reduce(
        (sum, lesson) => sum + positiveInteger(lesson.taskCount, 0),
        0,
      ),
    };
  });
}

function writeCatalog(courses) {
  writeJson(path.join(COURSES_ROOT, 'index.json'), { courses });

  for (const course of courses) {
    writeJson(path.join(COURSES_ROOT, course.id, 'index.json'), course);

    for (const lesson of course.lessons) {
      writeJson(
        path.join(COURSES_ROOT, course.id, lesson.id, 'index.json'),
        lesson,
      );
    }
  }
}

function rebuildGeneratedPagesRegistry(courses) {
  let code = 'export const generatedPages = {\n';

  for (const course of courses) {
    const lessonBlocks = [];

    for (const lesson of course.lessons) {
      const pageLines = [];

      for (const page of lesson.pages) {
        const lessonPagePath = path.join(
          GENERATED_PAGES_ROOT,
          course.id,
          lesson.id,
          page.id,
          'LessonPage.jsx',
        );

        if (!fs.existsSync(lessonPagePath)) continue;

        pageLines.push(
          `      ${JSON.stringify(page.id)}: () => import(${JSON.stringify(
            `./${course.id}/${lesson.id}/${page.id}/LessonPage.jsx`,
          )}),`,
        );
      }

      if (pageLines.length === 0) continue;

      lessonBlocks.push(
        `    ${JSON.stringify(lesson.id)}: {\n${pageLines.join(
          '\n',
        )}\n    },`,
      );
    }

    if (lessonBlocks.length === 0) continue;

    code += `  ${JSON.stringify(course.id)}: {\n`;
    code += `${lessonBlocks.join('\n')}\n`;
    code += '  },\n';
  }

  code += '};\n';

  ensureDir(GENERATED_PAGES_ROOT);
  fs.writeFileSync(
    path.join(GENERATED_PAGES_ROOT, 'registry.js'),
    code,
    'utf8',
  );
}

function resolveInputFiles() {
  if (rawInputPath) {
    const resolvedPath = path.resolve(rawInputPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Input path does not exist: ${resolvedPath}`);
    }

    if (fs.statSync(resolvedPath).isFile()) {
      return [resolvedPath];
    }

    return findH5pFiles(resolvedPath).sort();
  }

  return findH5pFiles(INPUT_DIR).sort();
}

async function runImportOnce() {
  if (cli.clean) {
    console.log('Cleaning generated output...');
    cleanDir(COURSES_ROOT);
    cleanDir(GENERATED_PAGES_ROOT);
  } else {
    ensureDir(COURSES_ROOT);
    ensureDir(GENERATED_PAGES_ROOT);
  }

  const files = resolveInputFiles();
  const courses = cli.clean ? [] : loadExistingCourses();

  discoverGeneratedPublicPages(courses);

  // Import H5P files
  let successCount = 0;
  let failCount = 0;

  for (const file of files) {
    try {
      const parts = getInputPartsFromArchive(file);
      const courseId = safeFileName(parts.courseTitle);
      const lessonId = safeFileName(parts.lessonTitle);
      const pageId = safeFileName(parts.pageTitle);
      const targetRoot = path.join(
        COURSES_ROOT,
        courseId,
        lessonId,
        'pages',
        pageId,
      );
      const publicBase =
        `/courses/${courseId}/${lessonId}/pages/${pageId}`;

      const job = {
        h5pPath: file,
        courseId,
        lessonId,
        pageId,
        pageTitle: parts.pageTitle,
        targetRoot,
        publicBase,
      };

      const manifest = processH5p(job);

      upsertPage(courses, {
        courseId,
        courseTitle: parts.courseTitle,
        lessonId,
        lessonTitle: parts.lessonTitle,
        page: {
          id: pageId,
          title: manifest.title,
          taskCount: manifest.taskCount,
        },
      });

      successCount += 1;
    } catch (error) {
      console.error(`\nFailed to import ${file}`);
      console.error(error);
      failCount += 1;
    }
  }

  // Import Google Slides from mapping
  const SLIDES_MAPPING_PATH = path.resolve('src/config/slides_mapping.json');
  if (fs.existsSync(SLIDES_MAPPING_PATH)) {
    try {
      const slidesMapping = JSON.parse(fs.readFileSync(SLIDES_MAPPING_PATH, 'utf8'));
      console.log(`\nProcessing slides from mapping: ${SLIDES_MAPPING_PATH}`);

      for (const [key, url] of Object.entries(slidesMapping)) {
        try {
          const parts = getInputPartsFromArchive(key);
          const courseId = safeFileName(parts.courseTitle);
          const lessonId = safeFileName(parts.lessonTitle);
          const pageId = safeFileName(parts.pageTitle);
          const targetRoot = path.join(
            COURSES_ROOT,
            courseId,
            lessonId,
            'pages',
            pageId,
          );
          const publicBase =
            `/courses/${courseId}/${lessonId}/pages/${pageId}`;

          const job = {
            filePath: `src/config/slides_mapping.json [${key}]`,
            courseId,
            lessonId,
            pageId,
            pageTitle: parts.pageTitle,
            targetRoot,
            publicBase,
          };

          const manifest = processGoogleSlides(job, url);

          upsertPage(courses, {
            courseId,
            courseTitle: parts.courseTitle,
            lessonId,
            lessonTitle: parts.lessonTitle,
            page: {
              id: pageId,
              title: manifest.title,
              taskCount: manifest.taskCount,
            },
          });
        } catch (error) {
          console.error(`\nFailed to process slide mapping for key ${key}`);
          console.error(error);
        }
      }
    } catch (error) {
      console.error(`\nFailed to read or parse slides mapping file: ${error.message}`);
    }
  }

  discoverGeneratedPublicPages(courses);

  const normalizedCourses = normalizeCourses(courses);
  writeCatalog(normalizedCourses);
  rebuildGeneratedPagesRegistry(normalizedCourses);

  console.log(`\nImported H5P files: ${successCount}, Failed: ${failCount}`);
}

function printHelp() {
  console.log(`Usage:
  npm run import
  node scripts/importH5p.mjs <file-or-folder>
  node scripts/importH5p.mjs --clean <file-or-folder>
  node scripts/importH5p.mjs --watch

The importer accepts both .h5p and .zip files. It merges new activities
into the existing course index and automatically calculates taskCount.`);
}

async function start() {
  if (cli.help) {
    printHelp();
    return;
  }

  await runImportOnce();

  if (!cli.watch) return;

  ensureDir(INPUT_DIR);
  console.log(`\nWatching ${INPUT_DIR} for H5P changes...`);

  let timer = null;
  let running = false;
  let rerunRequested = false;

  const queueImport = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (running) {
        rerunRequested = true;
        return;
      }

      running = true;
      try {
        await runImportOnce();
      } finally {
        running = false;
        if (rerunRequested) {
          rerunRequested = false;
          queueImport();
        }
      }
    }, 300);
  };

  fs.watch(INPUT_DIR, { recursive: true }, queueImport);
}

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
