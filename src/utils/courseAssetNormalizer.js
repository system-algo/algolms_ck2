function sanitizeRelPath(relPath) {
  return String(relPath || '')
    .split(/[\\/]/)
    .map((seg) => seg.replace(/\.+$/, ''))
    .join('/');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

/**
 * Normalizes all manifest and pageInstance image/media asset paths to internal
 * course paths (/courses/<courseId>/<lessonId>/pages/<pageId>/assets/...).
 * Acts as a runtime defense layer to guarantee no external LMS domain or generic
 * /assets/ paths leak to the user interface.
 */
export function normalizeManifestAssetPaths(manifestOrInstance, options = {}) {
  if (!manifestOrInstance) return manifestOrInstance;

  const target = cloneJson(manifestOrInstance);
  const courseId = String(
    options.courseId ||
      target.metadata?.courseId ||
      target.course?.id ||
      'GD'
  ).trim();
  const lessonId = String(
    options.lessonId ||
      target.metadata?.lessonId ||
      target.lesson?.id ||
      ''
  ).trim();
  const pageId = String(
    options.pageId ||
      target.metadata?.pageId ||
      target.page?.id ||
      ''
  ).trim();

  const pagePublicBase = `/courses/${encodeURI(courseId)}/${encodeURI(lessonId)}/pages/${encodeURI(pageId)}`;
  const pageAssetsBase = `${pagePublicBase}/assets`;
  const courseAssetsBase = `/courses/${encodeURI(courseId)}/assets`;

  // Build map of url -> local path from downloadedAssets across tasks/states
  const urlToLocal = new Map();
  const tasks = Array.isArray(target.tasks) ? target.tasks : [];

  for (const task of tasks) {
    const states = Array.isArray(task.states) ? task.states : [];
    for (const state of states) {
      const downloaded = state.downloadedAssets?.downloaded || [];
      for (const item of downloaded) {
        if (!item?.url) continue;
        const rawFilename = String(item.filename || '');
        const match = rawFilename.match(/(?:^|[\\/])assets[\\/](.+)$/i);
        const rel = match ? match[1] : rawFilename;
        const cleanRel = sanitizeRelPath(rel);
        const localPath = `${pageAssetsBase}/${cleanRel}`;

        urlToLocal.set(item.url, localPath);
        try {
          urlToLocal.set(decodeURI(item.url), localPath);
          urlToLocal.set(decodeURIComponent(item.url), localPath);
        } catch {}
      }
    }
  }

  function normalizeUrl(value) {
    if (!value || typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return trimmed;

    // Already a course local path
    if (trimmed.startsWith('/courses/')) {
      return trimmed;
    }

    if (urlToLocal.has(trimmed)) {
      return urlToLocal.get(trimmed);
    }

    try {
      const decoded = decodeURIComponent(trimmed);
      if (urlToLocal.has(decoded)) {
        return urlToLocal.get(decoded);
      }
    } catch {}

    // Generic /assets/ paths
    if (trimmed.startsWith('/assets/finish/')) {
      return `${pageAssetsBase}/finish/${trimmed.slice('/assets/finish/'.length)}`;
    }
    if (trimmed.startsWith('/assets/feedback/')) {
      return `${courseAssetsBase}/feedback/${trimmed.slice('/assets/feedback/'.length)}`;
    }
    if (trimmed.startsWith('/assets/shared/')) {
      return `${courseAssetsBase}/shared/${trimmed.slice('/assets/shared/'.length)}`;
    }
    if (trimmed.startsWith('/assets/activity-options/')) {
      return `${pageAssetsBase}/activity-options/${trimmed.slice('/assets/activity-options/'.length)}`;
    }
    if (trimmed.startsWith('/assets/')) {
      return `${pageAssetsBase}/${trimmed.slice('/assets/'.length)}`;
    }

    // External LMS URLs
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      try {
        const u = new URL(trimmed);
        if (
          u.hostname.includes('logikaschool') ||
          u.hostname.includes('alg.academy') ||
          u.hostname.includes('algolms')
        ) {
          const parts = u.pathname.split('/');
          const filename = parts[parts.length - 1];
          for (const [knownUrl, localPath] of urlToLocal.entries()) {
            if (knownUrl.endsWith(filename)) {
              return localPath;
            }
          }
          return `${pageAssetsBase}/${filename}`;
        }
      } catch {}
    }

    return trimmed;
  }

  function deeplyNormalize(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
      return obj.map(deeplyNormalize);
    }
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        const lowerKey = k.toLowerCase();
        if (
          lowerKey === 'src' ||
          lowerKey === 'image' ||
          lowerKey === 'imageurl' ||
          lowerKey === 'imagesrc' ||
          lowerKey === 'localsrc' ||
          lowerKey === 'publicsrc' ||
          (lowerKey.includes('image') && v.match(/\.(png|jpe?g|gif|svg|webp)/i))
        ) {
          obj[k] = normalizeUrl(v);
        }
      } else if (Array.isArray(v)) {
        if (k === 'rasterImageUrls') {
          obj[k] = v.map((item) => (typeof item === 'string' ? normalizeUrl(item) : item));
        } else {
          obj[k] = v.map(deeplyNormalize);
        }
      } else if (typeof v === 'object') {
        deeplyNormalize(v);
      }
    }
    return obj;
  }

  return deeplyNormalize(target);
}
