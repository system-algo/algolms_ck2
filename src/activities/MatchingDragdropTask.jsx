import { useEffect, useMemo, useState } from 'react';
import './MatchingDragdropTask.css';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import { buildAuthenticatedActivityAttempt } from '../lib/ck2BackendAttempt.js';
import {
  getMatchingData,
  getUniqueImages,
  loadLocalTaskState,
  saveLocalTaskState,
  resolveActivityMapUrl,
} from '../lib/taskExtractors.js';

const API_BASE_URL = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const SESSION_STORAGE_KEY = 'algolms_session_id';

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getTaskId(task) {
  return String(task?.id || task?.taskId || '').trim();
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

function firstArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length > 0) || [];
}

function getTaskRendererConfig(pageInstance, task) {
  const taskId = getTaskId(task);

  if (!taskId) return null;

  const taskRenderer = pageInstance?.taskRenderers?.[taskId] || null;

  return (
    taskRenderer?.matchingDragdrop ||
    taskRenderer?.matching ||
    taskRenderer?.data ||
    task?.matchingDragdrop ||
    task?.matching ||
    null
  );
}

function isBadLabel(value) {
  const text = normalizeText(value).toLowerCase();

  return (
    !text ||
    text === 'background-image' ||
    text === 'image' ||
    text === 'answer' ||
    text === 'check' ||
    text === 'reset' ||
    text === 'next' ||
    /^attempt\s*:?\s*\d+\/\d+$/i.test(text)
  );
}

function toItem(rawItem, index) {
  if (typeof rawItem === 'string') {
    return {
      id: `item-${index + 1}`,
      text: rawItem,
    };
  }

  const text = normalizeText(
    rawItem?.text ||
      rawItem?.label ||
      rawItem?.title ||
      rawItem?.name ||
      rawItem?.value ||
      '',
  );

  return {
    ...rawItem,
    id: String(rawItem?.id || rawItem?.itemId || rawItem?.value || normalizeKey(text) || `item-${index + 1}`),
    text,
  };
}

function getNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getMatchingMode(config) {
  return normalizeText(config?.mode || config?.layout || config?.type).toLowerCase();
}

function isImageDropMode(config) {
  const mode = getMatchingMode(config);

  return [
    'image-drop',
    'image-dragdrop',
    'image-drag-drop',
    'diagram-drop',
    'diagram-dragdrop',
    'diagram-labeling',
  ].includes(mode);
}

function isCategoryDropMode(config) {
  const mode = getMatchingMode(config);

  return [
    'category-dragdrop',
    'category-drop',
    'categorize',
    'categorize-dragdrop',
    'two-categories',
  ].includes(mode);
}

function toCategory(rawCategory, index) {
  if (typeof rawCategory === 'string') {
    return {
      id: `category-${index + 1}`,
      title: rawCategory,
    };
  }

  return {
    id: String(
      rawCategory?.id ||
        rawCategory?.categoryId ||
        rawCategory?.zoneId ||
        rawCategory?.targetId ||
        `category-${index + 1}`,
    ),
    title: normalizeText(
      rawCategory?.title ||
        rawCategory?.text ||
        rawCategory?.label ||
        rawCategory?.name ||
        '',
    ),
  };
}

function getManifestBase(pageInstance) {
  const manifest = String(pageInstance?.manifest || '');

  if (!manifest) return '';

  return manifest.replace(/\/manifest\.json$/i, '');
}

function isImagePath(value) {
  const text = String(value || '').trim();

  if (!text) return false;

  return /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(text);
}

function extractImageUrlsFromString(value) {
  const text = String(value || '');
  const urls = [];

  const urlRegex = /url\((['"]?)(.*?)\1\)/gi;
  let match = urlRegex.exec(text);

  while (match) {
    if (isImagePath(match[2])) {
      urls.push(match[2]);
    }

    match = urlRegex.exec(text);
  }

  if (isImagePath(text)) {
    urls.push(text);
  }

  return urls;
}

function normalizeImageSrc(src, pageInstance) {
  const raw = String(src || '').trim();

  if (!raw) return '';

  if (/^(https?:|data:|blob:|\/)/i.test(raw)) {
    return raw;
  }

  const base = getManifestBase(pageInstance);

  if (!base) return raw;

  return `${base}/${raw.replace(/^\.?\//, '')}`;
}

function toImage(src, index, pageInstance) {
  if (!src) return null;

  if (typeof src === 'string') {
    const normalizedSrc = normalizeImageSrc(src, pageInstance);

    return normalizedSrc
      ? {
          id: `image-${index + 1}`,
          src: normalizedSrc,
          alt: '',
        }
      : null;
  }

  const rawSrc =
    src?.src ||
    src?.url ||
    src?.path ||
    src?.href ||
    src?.file ||
    src?.asset ||
    src?.assetPath ||
    src?.localSrc ||
    src?.publicSrc ||
    '';

  const normalizedSrc = normalizeImageSrc(rawSrc, pageInstance);

  if (!normalizedSrc) return null;

  return {
    id: String(src?.id || src?.imageId || `image-${index + 1}`),
    src: normalizedSrc,
    alt: normalizeText(src?.alt || src?.title || src?.label || ''),
    width: src?.width || src?.naturalWidth || src?.rect?.w || null,
    height: src?.height || src?.naturalHeight || src?.rect?.h || null,
    rect: src?.rect || null,
  };
}

function uniqueImages(images) {
  const seen = new Set();

  return images.filter((image) => {
    if (!image?.src) return false;

    const key = image.src;

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function collectImagesDeep(value, pageInstance, result = [], visited = new Set()) {
  if (!value) return result;

  if (typeof value === 'string') {
    extractImageUrlsFromString(value).forEach((src) => {
      const image = toImage(src, result.length, pageInstance);

      if (image) result.push(image);
    });

    return result;
  }

  if (typeof value !== 'object') return result;
  if (visited.has(value)) return result;

  visited.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => collectImagesDeep(item, pageInstance, result, visited));
    return result;
  }

  const directSrc =
    value.src ||
    value.url ||
    value.path ||
    value.href ||
    value.file ||
    value.asset ||
    value.assetPath ||
    value.localSrc ||
    value.publicSrc ||
    '';

  if (isImagePath(directSrc)) {
    const image = toImage(value, result.length, pageInstance);

    if (image) result.push(image);
  }

  Object.values(value).forEach((child) => {
    collectImagesDeep(child, pageInstance, result, visited);
  });

  return result;
}

function collectTaskScopedObjects(value, taskId, result = [], visited = new Set()) {
  if (!value || typeof value !== 'object') return result;
  if (visited.has(value)) return result;

  visited.add(value);

  if (
    String(value.id || '') === taskId ||
    String(value.taskId || '') === taskId ||
    String(value.pageTaskId || '') === taskId
  ) {
    result.push(value);
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectTaskScopedObjects(item, taskId, result, visited));
    return result;
  }

  Object.entries(value).forEach(([key, child]) => {
    if (key === taskId && child && typeof child === 'object') {
      result.push(child);
    }

    collectTaskScopedObjects(child, taskId, result, visited);
  });

  return result;
}

function getCorrectItemIdForTarget(targetId, answerKey, items) {
  if (!targetId || !answerKey || typeof answerKey !== 'object') return '';

  const source =
    answerKey.assignments ||
    answerKey.pairs ||
    answerKey.matches ||
    answerKey.answerKey ||
    answerKey;

  const directValue = source[targetId];

  if (typeof directValue === 'string') {
    return directValue;
  }

  if (Array.isArray(directValue)) {
    return String(directValue[0] || '');
  }

  const reverseEntry = Object.entries(source).find(([, value]) => {
    if (Array.isArray(value)) {
      return value.includes(targetId);
    }

    return String(value || '') === targetId;
  });

  if (reverseEntry) {
    return String(reverseEntry[0] || '');
  }

  const matchingItem = items.find((item) => {
    return (
      source[item.id] === targetId ||
      source[item.text] === targetId ||
      source[normalizeText(item.text)] === targetId
    );
  });

  return matchingItem?.id || '';
}

function toTarget(rawTarget, index, answerKey = {}, pageInstance = null, items = []) {
  if (typeof rawTarget === 'string') {
    const id = `target-${index + 1}`;

    return {
      id,
      text: rawTarget,
      correctItemId: getCorrectItemIdForTarget(id, answerKey, items),
      image: null,
      imageIndex: null,
      imageAlt: '',
      x: null,
      y: null,
      width: null,
      height: null,
    };
  }

  const id = String(
    rawTarget?.id ||
      rawTarget?.targetId ||
      rawTarget?.zoneId ||
      rawTarget?.categoryId ||
      `target-${index + 1}`,
  );

  const rect = rawTarget?.rect || rawTarget?.dropZone || rawTarget?.position || {};
  const image = toImage(rawTarget?.image || rawTarget?.img || rawTarget?.picture, index, pageInstance);

  const rawText =
    rawTarget?.text ||
    rawTarget?.label ||
    rawTarget?.definition ||
    rawTarget?.title ||
    rawTarget?.name ||
    image?.alt ||
    rawTarget?.imageAlt ||
    '';

  const explicitCorrect =
    rawTarget?.correctItemId ||
    rawTarget?.correct ||
    rawTarget?.answer ||
    '';

  return {
    id,
    text: normalizeText(rawText),
    correctItemId: String(
      explicitCorrect || getCorrectItemIdForTarget(id, answerKey, items) || '',
    ),
    image,
    imageIndex: getNumber(rawTarget?.imageIndex, null),
    imageAlt: normalizeText(rawTarget?.imageAlt || image?.alt || rawText || ''),
    x: getNumber(rawTarget?.x ?? rawTarget?.left ?? rect.x ?? rect.left),
    y: getNumber(rawTarget?.y ?? rawTarget?.top ?? rect.y ?? rect.top),
    width: getNumber(rawTarget?.width ?? rawTarget?.w ?? rect.width ?? rect.w, 18),
    height: getNumber(rawTarget?.height ?? rawTarget?.h ?? rect.height ?? rect.h, 8),
  };
}

function buildDataFromConfig(config, fallbackData, task, pageInstance) {
  const safeConfig = config || {};
  const answerKey = safeConfig.answerKey || safeConfig.answer_key || {};
  const imageMode = isImageDropMode(safeConfig);
  const categoryMode = isCategoryDropMode(safeConfig);

  const fallbackTerms = Array.isArray(fallbackData?.terms) ? fallbackData.terms : [];
  const fallbackTargets = Array.isArray(fallbackData?.targets) ? fallbackData.targets : [];

  const rawItems = firstArray(
    safeConfig.items,
    safeConfig.options,
    safeConfig.cards,
    safeConfig.choices,
    safeConfig.terms,
    safeConfig.leftItems,
    safeConfig.draggables,
    fallbackTerms,
  );

  const items = rawItems
    .map(toItem)
    .filter((item) => item.text && !isBadLabel(item.text));

  const rawTargets = firstArray(
    safeConfig.dropZones,
    safeConfig.dropzones,
    safeConfig.targets,
    safeConfig.zones,
    safeConfig.rightItems,
    safeConfig.definitions,
    fallbackTargets,
  );

  const targets = rawTargets
    .map((target, index) => toTarget(target, index, answerKey, pageInstance, items))
    .filter((target) => target.text || target.image || target.imageIndex !== null || target.x !== null || target.y !== null);

  const rawCategories = firstArray(
    safeConfig.categories,
    safeConfig.categoryTargets,
    safeConfig.categoryZones,
  );

  const categories = rawCategories
    .map(toCategory)
    .filter((category) => category.title && !isBadLabel(category.title));

  const imageInputs = [];

  if (safeConfig.image) imageInputs.push(safeConfig.image);
  if (safeConfig.imageSrc) imageInputs.push(safeConfig.imageSrc);
  if (safeConfig.picture) imageInputs.push(safeConfig.picture);
  if (Array.isArray(safeConfig.images)) imageInputs.push(...safeConfig.images);

  const configuredImages = imageInputs
    .map((image, index) => toImage(image, index, pageInstance))
    .filter((image) => image?.src);

  const autoImages = imageMode
    ? uniqueImages([
        ...configuredImages,
        ...collectImagesDeep(safeConfig, pageInstance),
        ...collectImagesDeep(fallbackData, pageInstance),
        ...collectImagesDeep(task, pageInstance),
      ])
    : configuredImages;

  return {
    title: normalizeText(safeConfig.title || fallbackData?.title || task?.title || ''),
    prompt: normalizeText(safeConfig.prompt || fallbackData?.prompt || task?.prompt || 'Match the items.'),
    helperText: normalizeText(safeConfig.helperText || safeConfig.subtitle || ''),
    attemptLabel: normalizeText(safeConfig.attempt || ''),
    attemptsAllowed: Infinity,
    items,
    targets,
    images: autoImages,
    imageDropMode: imageMode,
    categoryDropMode: categoryMode,
    categories,
    answerKey,
    showCapturedImage:
      safeConfig.showCapturedImage !== false &&
      safeConfig.preserveCapturedImages !== false,
  };
}

function getSolvedState(targets, assignments) {
  const results = {};

  targets.forEach((target) => {
    if (!target.correctItemId) {
      results[target.id] = null;
      return;
    }

    results[target.id] = assignments[target.id] === target.correctItemId;
  });

  return results;
}

function hasAnswerKey(targets) {
  return targets.length > 0 && targets.every((target) => Boolean(target.correctItemId));
}

function isAllCorrect(targets, assignments) {
  if (!hasAnswerKey(targets)) return false;

  return targets.every((target) => assignments[target.id] === target.correctItemId);
}

function getTransferItemId(event) {
  return (
    event.dataTransfer.getData('application/x-lms-item') ||
    event.dataTransfer.getData('text/plain') ||
    ''
  );
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, value));
}

export default function MatchingDragdropTask({
  task,
  pageInstance,
  onPrevTask,
  onNextTask,
  isTaskDone,
}) {
  const taskId = getTaskId(task);

  const fallbackData = useMemo(() => getMatchingData(task), [task]);

  const config = useMemo(
    () => getTaskRendererConfig(pageInstance, task),
    [pageInstance, task],
  );

  const [manualMapConfig, setManualMapConfig] = useState(null);

  useEffect(() => {
    let cancelled = false;

    setManualMapConfig(null);

    const url = resolveActivityMapUrl(pageInstance?.manualActivityMap);

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
          manualTask?.matchingDragdrop ||
          manualTask?.matching ||
          manualTask?.data ||
          null;

        setManualMapConfig(nextConfig);
      })
      .catch(() => {
        if (!cancelled) {
          setManualMapConfig(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pageInstance?.manualActivityMap?.url, taskId]);

  const effectiveConfig = manualMapConfig || config;

  const data = useMemo(
    () => buildDataFromConfig(effectiveConfig, fallbackData, task, pageInstance),
    [effectiveConfig, fallbackData, task, pageInstance],
  );

  const capturedImages = useMemo(() => {
    return uniqueImages(
      getUniqueImages(task)
        .map((image, index) => toImage(image, index, pageInstance))
        .filter((image) => image?.src),
    );
  }, [task, pageInstance]);

  const [manifestImages, setManifestImages] = useState([]);

  useEffect(() => {
    let cancelled = false;

    setManifestImages([]);

    if (data.images.length > 0) return undefined;
    if (capturedImages.length > 0) return undefined;
    if (!pageInstance?.manifest) return undefined;

    fetch(pageInstance.manifest)
      .then((response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((manifest) => {
        if (cancelled || !manifest) return;

        const scopedObjects = collectTaskScopedObjects(manifest, taskId);
        const scopedImages = uniqueImages(
          scopedObjects.flatMap((item) => collectImagesDeep(item, pageInstance)),
        );

        if (scopedImages.length > 0) {
          setManifestImages(scopedImages);
          return;
        }

        setManifestImages(uniqueImages(collectImagesDeep(manifest, pageInstance)));
      })
      .catch(() => {
        if (!cancelled) {
          setManifestImages([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [data.images.length, capturedImages.length, pageInstance, taskId]);

  const [assignments, setAssignments] = useState(() => {
    const saved = loadLocalTaskState(taskId, null);
    return saved?.assignments || {};
  });
  const [categoryAssignments, setCategoryAssignments] = useState(() => {
    const saved = loadLocalTaskState(taskId, null);
    return saved?.categoryAssignments || {};
  });
  const [freePlacements, setFreePlacements] = useState(() => {
    const saved = loadLocalTaskState(taskId, null);
    return saved?.freePlacements || {};
  });
  const [selectedItemId, setSelectedItemId] = useState('');
  const [attemptsUsed, setAttemptsUsed] = useState(() => {
    const saved = loadLocalTaskState(taskId, null);
    return saved?.attemptsUsed || 0;
  });
  const [checkResult, setCheckResult] = useState(() => {
    const saved = loadLocalTaskState(taskId, null);
    return saved?.checkResult || {};
  });
  const [feedback, setFeedback] = useState(() => {
    const saved = loadLocalTaskState(taskId, null);
    return saved?.feedback || '';
  });
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const saved = loadLocalTaskState(taskId, null);

    setAssignments(saved?.assignments || {});
    setCategoryAssignments(saved?.categoryAssignments || {});
    setFreePlacements(saved?.freePlacements || {});
    setSelectedItemId('');
    setAttemptsUsed(saved?.attemptsUsed || 0);
    setCheckResult(saved?.checkResult || {});
    setFeedback(saved?.feedback || '');
    setChecking(false);
  }, [taskId]);

  useEffect(() => {
    if (Object.keys(assignments).length > 0 || Object.keys(categoryAssignments).length > 0 || feedback) {
      saveLocalTaskState(taskId, {
        assignments,
        categoryAssignments,
        freePlacements,
        attemptsUsed,
        checkResult,
        feedback,
      });
    }
  }, [taskId, assignments, categoryAssignments, freePlacements, attemptsUsed, checkResult, feedback]);

  function findItem(itemId) {
    return data.items.find((item) => item.id === itemId) || null;
  }

  function getExpectedCategoryId(item) {
    return (
      data.answerKey?.categoryAssignments?.[item.id] ||
      data.answerKey?.[item.id] ||
      data.answerKey?.[item.text] ||
      data.answerKey?.[normalizeText(item.text)] ||
      ''
    );
  }

  const imageDropTargets = useMemo(() => {
    return data.targets.filter((target) => target.x !== null && target.y !== null);
  }, [data.targets]);

  const hasFixedImageTargets = data.imageDropMode && imageDropTargets.length > 0;
  const isFreeImageDrop = data.imageDropMode && !hasFixedImageTargets;

  const assignedItemIds = useMemo(() => {
    const ids = new Set(Object.values(assignments).filter(Boolean));

    Object.values(freePlacements).forEach((placement) => {
      if (placement?.itemId) ids.add(placement.itemId);
    });

    Object.keys(categoryAssignments).forEach((itemId) => {
      if (itemId) ids.add(itemId);
    });

    return ids;
  }, [assignments, freePlacements, categoryAssignments]);

  const availableItems = data.items.filter((item) => !assignedItemIds.has(item.id));

  const checkTargets = hasFixedImageTargets ? imageDropTargets : data.targets;
  const normalSolved = isFreeImageDrop ? false : isAllCorrect(checkTargets, assignments);

  const categorySolved = (
    data.categoryDropMode &&
    data.items.length > 0 &&
    data.answerKey &&
    Object.keys(data.answerKey).length > 0 &&
    data.items.every((item) => {
      const expectedCategoryId = getExpectedCategoryId(item);

      if (!expectedCategoryId) {
        return !categoryAssignments[item.id];
      }

      return categoryAssignments[item.id] === expectedCategoryId;
    })
  );

  const solved = data.categoryDropMode ? categorySolved : normalSolved;
  const canCheck = true;

  const activeImages = data.images.length > 0
    ? data.images
    : capturedImages.length > 0
      ? capturedImages
      : manifestImages;

  function placeItem(targetId, itemId) {
    if (!targetId || !itemId || checking) return;

    setAssignments((current) => {
      const next = { ...current };

      Object.entries(next).forEach(([existingTargetId, existingItemId]) => {
        if (existingItemId === itemId) {
          delete next[existingTargetId];
        }
      });

      next[targetId] = itemId;

      return next;
    });

    setCategoryAssignments((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });

    setFreePlacements((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });

    setSelectedItemId('');
    setCheckResult({});
    setFeedback('');
  }

  function placeFreeItem(event, itemId) {
    if (!itemId || checking) return;

    const rect = event.currentTarget.getBoundingClientRect();

    const x = clampPercent(((event.clientX - rect.left) / rect.width) * 100);
    const y = clampPercent(((event.clientY - rect.top) / rect.height) * 100);

    setAssignments((current) => {
      const next = { ...current };

      Object.entries(next).forEach(([targetId, existingItemId]) => {
        if (existingItemId === itemId) {
          delete next[targetId];
        }
      });

      return next;
    });

    setCategoryAssignments((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });

    setFreePlacements((current) => ({
      ...current,
      [itemId]: {
        itemId,
        x,
        y,
      },
    }));

    setSelectedItemId('');
    setCheckResult({});
    setFeedback('');
  }

  function removePlacement(targetId) {
    if (checking) return;

    setAssignments((current) => {
      const next = { ...current };
      delete next[targetId];
      return next;
    });

    setCheckResult({});
    setFeedback('');
  }

  function removeFreePlacement(itemId) {
    if (checking) return;

    setFreePlacements((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });

    setCheckResult({});
    setFeedback('');
  }

  function placeCategoryItem(categoryId, itemId) {
    if (!categoryId || !itemId || checking) return;

    setAssignments((current) => {
      const next = { ...current };

      Object.entries(next).forEach(([targetId, existingItemId]) => {
        if (existingItemId === itemId) {
          delete next[targetId];
        }
      });

      return next;
    });

    setFreePlacements((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });

    setCategoryAssignments((current) => ({
      ...current,
      [itemId]: categoryId,
    }));

    setSelectedItemId('');
    setCheckResult({});
    setFeedback('');
  }

  function removeCategoryPlacement(itemId) {
    if (checking) return;

    setCategoryAssignments((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });

    setCheckResult({});
    setFeedback('');
  }

  function handleCategoryDrop(event, categoryId) {
    event.preventDefault();

    if (checking) return;

    const itemId = getTransferItemId(event);

    placeCategoryItem(categoryId, itemId);
  }

  function handleCategoryClick(categoryId) {
    if (!selectedItemId || checking) return;
    placeCategoryItem(categoryId, selectedItemId);
  }

  function handleDragStart(event, itemId) {
    event.dataTransfer.setData('application/x-lms-item', itemId);
    event.dataTransfer.setData('text/plain', itemId);
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleDrop(event, targetId) {
    event.preventDefault();

    if (checking) return;

    const itemId = getTransferItemId(event);

    placeItem(targetId, itemId);
  }

  function handleImageDrop(event) {
    event.preventDefault();

    if (checking) return;
    if (!isFreeImageDrop) return;

    const itemId = getTransferItemId(event);

    placeFreeItem(event, itemId);
  }

  function handleTargetClick(targetId) {
    if (!selectedItemId || checking) return;
    placeItem(targetId, selectedItemId);
  }

  function handleImageClick(event) {
    if (!isFreeImageDrop || !selectedItemId || checking) return;
    placeFreeItem(event, selectedItemId);
  }

  function reset() {
    if (checking) return;

    setAssignments({});
    setCategoryAssignments({});
    setFreePlacements({});
    setSelectedItemId('');
    setAttemptsUsed(0);
    setCheckResult({});
    setFeedback('');
  }

  function triggerSuccess() {
    window.dispatchEvent(
      new CustomEvent('LMS_TASK_COMPLETED', {
        detail: { taskId: task?.id || task?.taskId },
      })
    );

    if (onNextTask) {
      setTimeout(onNextTask, 1000);
    }
  }

  function runLocalCheck() {
    if (data.categoryDropMode) {
      const expectedItems = data.items.filter((item) => getExpectedCategoryId(item));

      if (!data.answerKey || !Object.keys(data.answerKey).length) {
        setAttemptsUsed((current) => Math.min(current + 1, data.attemptsAllowed));
        setFeedback('Answer saved locally. No answer key has been configured yet.');
        setCheckResult({});
        return false;
      }

      const placedExpectedCount = expectedItems.filter((item) => (
        categoryAssignments[item.id] === getExpectedCategoryId(item)
      )).length;

      if (placedExpectedCount < expectedItems.length) {
        setFeedback('A mistake has been made! Try again.');
        return false;
      }

      const nextResult = {};

      data.items.forEach((item) => {
        const expectedCategoryId = getExpectedCategoryId(item);

        if (!expectedCategoryId) {
          nextResult[item.id] = !categoryAssignments[item.id];
          return;
        }

        nextResult[item.id] = categoryAssignments[item.id] === expectedCategoryId;
      });

      const nextSolved = Object.values(nextResult).every(Boolean);

      setCheckResult(nextResult);
      setAttemptsUsed((current) => Math.min(current + 1, data.attemptsAllowed));
      setFeedback(nextSolved ? 'You got it!' : 'A mistake has been made! Try again.');
      // Wait for the backend to confirm the grading before marking completion.
      return nextSolved;
    }

    if (isFreeImageDrop) {
      const placedCount = Object.keys(freePlacements).length;

      if (placedCount < data.items.length) {
        setFeedback('A mistake has been made! Try again.');
        return false;
      }

      setAttemptsUsed((current) => Math.min(current + 1, data.attemptsAllowed));
      setFeedback('Answer saved locally. No fixed drop zones were configured.');
      setCheckResult({});
      return true;
    }

    const assignedCount = Object.values(assignments).filter(Boolean).length;
    const expectedMatchCount = data.items.length || checkTargets.length;

    if (assignedCount < expectedMatchCount) {
      setFeedback('A mistake has been made! Try again.');
      return false;
    }

    if (!hasAnswerKey(checkTargets)) {
      setFeedback('This task is interactive, but no answer key has been configured yet.');
      setCheckResult({});
      return false;
    }

    const nextResult = getSolvedState(checkTargets, assignments);
    const nextSolved = isAllCorrect(checkTargets, assignments);

    setCheckResult(nextResult);
    setAttemptsUsed((current) => Math.min(current + 1, data.attemptsAllowed));
    setFeedback(nextSolved ? 'You got it!' : 'A mistake has been made! Try again.');
    // Wait for the backend to confirm the grading before marking completion.
    return nextSolved;
  }

  function getAnswerPayload() {
    if (data.categoryDropMode) {
      return {
        categoryAssignments,
      };
    }

    if (isFreeImageDrop) {
      return {
        freePlacements,
      };
    }

    const activeTargets = hasFixedImageTargets ? imageDropTargets : data.targets;
    const meaningfulTargets = activeTargets.slice(0, data.items.length || activeTargets.length);

    return {
      assignments,
      targetOrder: meaningfulTargets.map((target) => target.id),
      itemOrder: meaningfulTargets.map((target) => assignments[target.id] || ''),
      itemTextOrder: meaningfulTargets.map((target) => {
        const item = findItem(assignments[target.id]);
        return item?.text || '';
      }),
    };
  }

  async function submitAttemptToBackend() {
    if (!API_BASE_URL) return null;

    const { courseId, lessonId, pageId } = getRuntimeIds(pageInstance);

    if (!courseId || !lessonId || !pageId || !taskId) {
      throw new Error('Missing courseId, lessonId, pageId, or taskId.');
    }

    const studentEmail = sessionStorage.getItem('lms_student_email') ||
      localStorage.getItem('lms_student_email') || '';
    const accessToken = sessionStorage.getItem('lms_access_token') ||
      localStorage.getItem('lms_access_token') || '';
    const { headers, payload: attemptPayload } = buildAuthenticatedActivityAttempt({
      studentEmail,
      accessToken,
      courseId,
      lessonId,
      pageId,
      taskId,
      activityType: 'matching-dragdrop',
      answer: getAnswerPayload(),
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

  async function check() {
    if (checking) return;

    setChecking(true);
    setFeedback('Checking...');

    const isLocalSolved = runLocalCheck();

    try {
      const saved = await submitAttemptToBackend();
      if (saved?.result?.isCorrect === true && isLocalSolved) {
        setFeedback('You got it!');
        triggerSuccess();
      } else if (saved?.result?.status === 'missing_answer_key') {
        setFeedback('Answer saved, but no backend answer key has been configured.');
      } else if (saved) {
        setFeedback(saved?.result?.feedback || 'Answer saved; please check your placements.');
      } else {
        setFeedback('Answer was not saved. Please try again.');
      }
    } catch (error) {
      console.error('[MATCHING_DRAGDROP_SUBMIT_ERROR]', error);
      setFeedback('Answer was not saved. Please try again.');
    } finally {
      setChecking(false);
    }
  }

  function renderToolbar() {
    return null;
  }

  function renderHeader() {
    return (
      <header className="matching-rule-header">
        {data.prompt ? <p>{data.prompt}</p> : null}
        {data.helperText ? <p>{data.helperText}</p> : null}
      </header>
    );
  }

  function renderCapturedImage() {
    const image = activeImages[0] || null;

    if (!image || !data.showCapturedImage) return null;

    return (
      <div className="matching-rule-captured-image">
        <img
          src={image.src}
          alt={image.alt || ''}
          draggable={false}
        />
      </div>
    );
  }

  function renderAnswerBank() {
    return (
      <section className="matching-rule-bank" aria-label="Draggable answers">
        {availableItems.length > 0 ? (
          availableItems.map((item) => (
            <button
              key={item.id}
              type="button"
              draggable={!checking}
              disabled={checking}
              className={`matching-rule-item ${selectedItemId === item.id ? 'is-selected' : ''}`}
              onClick={() => {
                if (checking) return;
                setSelectedItemId(item.id);
              }}
              onDragStart={(event) => handleDragStart(event, item.id)}
            >
              {item.text}
            </button>
          ))
        ) : (
          <div className="matching-rule-empty-bank">
            All names have been placed.
          </div>
        )}
      </section>
    );
  }

  function renderTargetDefinition(target) {
    const label = isBadLabel(target.text) ? '' : target.text;
    const indexedImage =
      target.imageIndex !== null && target.imageIndex !== undefined
        ? activeImages[target.imageIndex]
        : null;

    const image = target.image || indexedImage || null;

    if (image?.src) {
      return (
        <div className="matching-rule-image-target">
          <img
            className="matching-rule-target-image"
            src={image.src}
            alt={target.imageAlt || image.alt || label || ''}
            draggable={false}
          />

          {label && label !== target.imageAlt ? (
            <div className="matching-rule-target-label">
              {label}
            </div>
          ) : null}
        </div>
      );
    }

    return label || target.text || '';
  }

  function renderFeedback() {
    return null;
  }

  if (data.categoryDropMode) {
    return (
      <LmsActivityFrame
        title={data.title || data.prompt}
        status={feedback}
        onPrevTask={onPrevTask}
        onNextTask={onNextTask}
        onCheck={check}
        onReset={reset}
        isCheckDisabled={!canCheck || checking}
        isResetDisabled={checking}
        isCheckLoading={checking}
        isTaskDone={isTaskDone}
      >
        <article className="matching-rule-task matching-category-task">
          <div className="matching-rule-card">
            {renderToolbar()}
            {renderHeader()}
            {renderCapturedImage()}

            <section className="matching-category-bank" aria-label="Draggable answers">
              {availableItems.length > 0 ? (
                availableItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    draggable={!checking}
                    disabled={checking}
                    className={`matching-category-item ${selectedItemId === item.id ? 'is-selected' : ''}`}
                    onClick={() => {
                      if (checking) return;
                      setSelectedItemId(item.id);
                    }}
                    onDragStart={(event) => handleDragStart(event, item.id)}
                  >
                    {item.text}
                  </button>
                ))
              ) : (
                <div className="matching-category-empty">
                  All items have been placed.
                </div>
              )}
            </section>

            <section className="matching-category-zones" aria-label="Categories">
              {data.categories.map((category) => {
                const placedItems = data.items.filter((item) => categoryAssignments[item.id] === category.id);

                return (
                  <div
                    key={category.id}
                    className="matching-category-zone"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleCategoryDrop(event, category.id)}
                    onClick={() => handleCategoryClick(category.id)}
                  >
                    <h2>{category.title}</h2>

                    <div className="matching-category-zone-body">
                      {placedItems.map((item) => {
                        let resultClass = '';

                        return (
                          <button
                            key={item.id}
                            type="button"
                            draggable={!checking}
                            disabled={checking}
                            className={`matching-category-placed-item ${resultClass}`}
                            onDragStart={(event) => handleDragStart(event, item.id)}
                            onClick={(event) => {
                              event.stopPropagation();
                              removeCategoryPlacement(item.id);
                            }}
                            title="Click to remove"
                          >
                            {item.text}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </section>

            {renderFeedback()}
          </div>
        </article>
      </LmsActivityFrame>
    );
  }

  if (data.imageDropMode) {
    const image = activeImages[0] || null;

    return (
      <LmsActivityFrame
        title={data.title || data.prompt}
        status={feedback}
        onPrevTask={onPrevTask}
        onNextTask={onNextTask}
        onCheck={check}
        onReset={reset}
        isCheckDisabled={!canCheck || checking}
        isResetDisabled={checking}
        isCheckLoading={checking}
        isTaskDone={isTaskDone}
      >
        <article className="matching-rule-task matching-rule-task--image-drop">
          <div className="matching-rule-card">
            {renderToolbar()}
            {renderHeader()}

            <div className="matching-image-workspace">
              {renderAnswerBank()}

              <section className="matching-image-panel" aria-label="Image drop area">
                <div
                  className="matching-image-stage"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleImageDrop}
                  onClick={handleImageClick}
                >
                  {image ? (
                    <img
                      className="matching-image-base"
                      src={image.src}
                      alt={image.alt || ''}
                      draggable={false}
                    />
                  ) : (
                    <div className="matching-image-loading">
                      Loading captured image from manifest...
                    </div>
                  )}

                  {hasFixedImageTargets && imageDropTargets.map((target) => {
                    const assignedItem = findItem(assignments[target.id]);
                    let resultClass = '';

                    return (
                      <div
                        key={target.id}
                        className={`matching-image-slot ${assignedItem ? 'is-filled' : ''} ${resultClass}`}
                        style={{
                          left: `${target.x}%`,
                          top: `${target.y}%`,
                          width: `${target.width}%`,
                          height: `${target.height}%`,
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => handleDrop(event, target.id)}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleTargetClick(target.id);
                        }}
                      >
                        {assignedItem ? (
                          <button
                            type="button"
                            draggable={!checking}
                            disabled={checking}
                            className="matching-image-placed-block"
                            onDragStart={(event) => handleDragStart(event, assignedItem.id)}
                            onClick={(event) => {
                              event.stopPropagation();
                              removePlacement(target.id);
                            }}
                            title="Click to remove"
                          >
                            {assignedItem.text}
                          </button>
                        ) : (
                          <span className="matching-image-placeholder">
                            Drop here
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {isFreeImageDrop && Object.values(freePlacements).map((placement) => {
                    const item = findItem(placement.itemId);

                    if (!item) return null;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        draggable={!checking}
                        disabled={checking}
                        className="matching-image-free-block"
                        style={{
                          left: `${placement.x}%`,
                          top: `${placement.y}%`,
                        }}
                        onDragStart={(event) => handleDragStart(event, item.id)}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeFreePlacement(item.id);
                        }}
                        title="Click to remove"
                      >
                        {item.text}
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>

            {renderFeedback()}
          </div>
        </article>
      </LmsActivityFrame>
    );
  }

  return (
    <LmsActivityFrame
      title={data.title || data.prompt}
      status={feedback}
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
      onCheck={check}
      onReset={reset}
      isCheckDisabled={!canCheck || checking}
      isResetDisabled={checking}
      isCheckLoading={checking}
      isTaskDone={isTaskDone}
    >
      <article className="matching-rule-task">
        <div className="matching-rule-card">
          {renderToolbar()}
          {renderHeader()}

          <div className="matching-rule-workspace">
            {renderAnswerBank()}

            <section className="matching-rule-table" aria-label="Drop targets">
              {data.targets.map((target) => {
                const assignedItem = findItem(assignments[target.id]);
                let resultClass = '';

                return (
                  <div
                    key={target.id}
                    className={`matching-rule-row ${resultClass}`}
                  >
                    <div
                      className={`matching-rule-slot ${assignedItem ? 'is-filled' : ''}`}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleDrop(event, target.id)}
                      onClick={() => handleTargetClick(target.id)}
                    >
                      {assignedItem ? (
                        <button
                          type="button"
                          draggable={!checking}
                          disabled={checking}
                          className="matching-rule-placed-item"
                          onDragStart={(event) => handleDragStart(event, assignedItem.id)}
                          onClick={(event) => {
                            event.stopPropagation();
                            removePlacement(target.id);
                          }}
                          title="Click to remove"
                        >
                          {assignedItem.text}
                        </button>
                      ) : (
                        <span className="matching-rule-placeholder">
                          Drop here
                        </span>
                      )}
                    </div>

                    <div className="matching-rule-definition">
                      {renderTargetDefinition(target)}
                    </div>
                  </div>
                );
              })}
            </section>
          </div>

          {renderFeedback()}
        </div>
      </article>
    </LmsActivityFrame>
  );
}