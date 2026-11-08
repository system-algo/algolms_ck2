import {
  getAllConfiguredPlatformUrls,
  getMainPlatformOrigin,
} from '../lib/authConfig';

// Authentication context must be scoped to this browser tab. The LMS codebase
// still reads these legacy keys through localStorage, so redirect only those
// keys to sessionStorage while leaving all unrelated application storage alone.
export const TAB_SCOPED_LMS_KEYS = [
  'lms_student_email',
  'lms_user_email',
  'lms_course_id',
  'lms_supabase_url',
  'lms_supabase_key',
  'lms_access_token',
  'lms_backend_url',
  'lms_user_role',
  'lms_viewer_role',
  'lms_platform_origin',
];

const TAB_SCOPED_KEY_SET = new Set(TAB_SCOPED_LMS_KEYS);

let tabIsolatedStorageInstalled = false;

export function installTabIsolatedLmsStorage() {
  if (
    typeof window === 'undefined' ||
    tabIsolatedStorageInstalled ||
    window.__algoTabIsolatedLmsStorageInstalled
  ) {
    return;
  }
  tabIsolatedStorageInstalled = true;
  window.__algoTabIsolatedLmsStorageInstalled = true;

  const storagePrototype = window.Storage.prototype;
  const nativeGetItem = storagePrototype.getItem;
  const nativeSetItem = storagePrototype.setItem;
  const nativeRemoveItem = storagePrototype.removeItem;
  const nativeClear = storagePrototype.clear;
  const localStore = window.localStorage;
  const tabStore = window.sessionStorage;

  storagePrototype.getItem = function getItem(key) {
    const normalizedKey = String(key);
    if (this === localStore && TAB_SCOPED_KEY_SET.has(normalizedKey)) {
      return nativeGetItem.call(tabStore, normalizedKey);
    }
    return nativeGetItem.call(this, normalizedKey);
  };

  storagePrototype.setItem = function setItem(key, value) {
    const normalizedKey = String(key);
    if (this === localStore && TAB_SCOPED_KEY_SET.has(normalizedKey)) {
      return nativeSetItem.call(tabStore, normalizedKey, String(value));
    }
    return nativeSetItem.call(this, normalizedKey, String(value));
  };

  storagePrototype.removeItem = function removeItem(key) {
    const normalizedKey = String(key);
    if (this === localStore && TAB_SCOPED_KEY_SET.has(normalizedKey)) {
      return nativeRemoveItem.call(tabStore, normalizedKey);
    }
    return nativeRemoveItem.call(this, normalizedKey);
  };

  storagePrototype.clear = function clear() {
    if (this === localStore) {
      for (const key of TAB_SCOPED_LMS_KEYS) {
        nativeRemoveItem.call(tabStore, key);
      }
    }
    return nativeClear.call(this);
  };

  // Never inherit browser-wide identity left by an older deployment.
  for (const key of TAB_SCOPED_LMS_KEYS) {
    try {
      nativeRemoveItem.call(localStore, key);
    } catch {}
  }
}

// Auto-install tab-isolated storage upon module load to guard early access
installTabIsolatedLmsStorage();

export function clearTabScopedLmsContext() {
  for (const key of TAB_SCOPED_LMS_KEYS) {
    localStorage.removeItem(key);
  }
}

function decodeJwtPayload(token) {
  const payloadPart = String(token || '').split('.')[1];
  if (!payloadPart) throw new Error('Invalid LMS access token.');

  const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const bytes = Uint8Array.from(window.atob(padded), (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function assertTokenMatchesContext(context) {
  const viewerRole = String(context?.viewerRole || '').trim().toLowerCase();
  const teacherEmail = String(context?.teacherEmail || '').trim().toLowerCase();
  const studentEmail = String(context?.studentEmail || '').trim().toLowerCase();
  const expectedEmail =
    viewerRole === 'teacher' || viewerRole === 'admin'
      ? teacherEmail || studentEmail
      : studentEmail || teacherEmail;
  const tokenEmail = String(decodeJwtPayload(context?.accessToken).email || '')
    .trim()
    .toLowerCase();

  if (!expectedEmail || !tokenEmail || tokenEmail !== expectedEmail) {
    throw new Error('LMS handoff identity does not match the access token.');
  }
}

const LMS_HANDOFF_TYPE = 'ALGO_LMS_HANDOFF';
const LMS_READY_TYPE = 'ALGO_LMS_READY';
const LMS_ACK_TYPE = 'ALGO_LMS_HANDOFF_ACK';
const APPLIED_HANDOFF_KEY = 'algo_lms_secure_handoff_applied';

const CHILD_SESSION_DURATION_MS = 60 * 60 * 1000;
const HANDOFF_RECOVERY_GRACE_MS = 15 * 1000;
const CHILD_SESSION_DEADLINE_KEY = 'algo_child_session_deadline';
const CHILD_SESSION_EXPIRED_KEY = 'algo_child_session_expired';

function buildAllowedPlatformOrigins() {
  const origins = new Set([
    'http://localhost:5173',
    'http://localhost:5174',
    'https://learn.algo.edu.vn',
  ]);

  try {
    origins.add(getMainPlatformOrigin());
    for (const urlStr of getAllConfiguredPlatformUrls()) {
      try {
        origins.add(new URL(urlStr).origin);
      } catch {}
    }
  } catch {}

  if (typeof window !== 'undefined') {
    const parts = window.location.hostname.split('.');
    if (parts.length >= 3) {
      origins.add(`${window.location.protocol}//${parts.slice(1).join('.')}`);
    }
  }

  return origins;
}

const ALLOWED_PLATFORM_ORIGINS = buildAllowedPlatformOrigins();

let refreshPromise = null;

function normalize(value) {
  return String(value ?? '').trim();
}

export function startFreshChildSession(durationMs = CHILD_SESSION_DURATION_MS) {
  sessionStorage.setItem(
    CHILD_SESSION_DEADLINE_KEY,
    String(Date.now() + durationMs),
  );
  sessionStorage.removeItem(CHILD_SESSION_EXPIRED_KEY);
}

function prepareExpiredSessionForHandoff() {
  if (sessionStorage.getItem(CHILD_SESSION_EXPIRED_KEY) !== '1') {
    return;
  }

  // The learner may be returning to this LMS in the same tab after its
  // previous one-hour child session expired. Give the trusted parent portal a
  // short handoff window instead of immediately redirecting back again.
  sessionStorage.removeItem(APPLIED_HANDOFF_KEY);
  startFreshChildSession(HANDOFF_RECOVERY_GRACE_MS);
}

export function receiveSecureLmsHandoff(event) {
  if (!event || !ALLOWED_PLATFORM_ORIGINS.has(event.origin)) return false;
  if (window.opener && event.source !== window.opener) return false;

  const data = event.data || {};
  if (data.type !== LMS_HANDOFF_TYPE || !data.handoffId || !data.context) return false;

  const context = data.context;
  assertTokenMatchesContext(context);
  clearTabScopedLmsContext();

  const teacherEmail = normalize(context?.teacherEmail).toLowerCase();
  const studentEmail = normalize(context?.studentEmail).toLowerCase();
  const userEmail = normalize(context?.userEmail || context?.email).toLowerCase();
  const email = teacherEmail || studentEmail || userEmail;
  const courseId = normalize(context?.courseId);
  const supabaseUrl = normalize(context?.supabaseUrl);
  const supabaseKey = normalize(context?.supabaseKey);
  const accessToken = normalize(context?.accessToken);
  const backendUrl = normalize(context?.backendUrl);
  const viewerRole = normalize(context?.viewerRole).toLowerCase();
  const platformOrigin = normalize(context?.platformOrigin || event.origin);

  if (!email || !courseId || !supabaseUrl || !supabaseKey || !accessToken) {
    throw new Error('Incomplete secure LMS handoff context.');
  }

  localStorage.setItem('lms_student_email', email);
  localStorage.setItem('lms_user_email', userEmail || email);
  localStorage.setItem('lms_course_id', courseId);
  localStorage.setItem('lms_supabase_url', supabaseUrl);
  localStorage.setItem('lms_supabase_key', supabaseKey);
  localStorage.setItem('lms_access_token', accessToken);

  if (backendUrl) {
    localStorage.setItem('lms_backend_url', backendUrl);
  }

  if (platformOrigin) {
    localStorage.setItem('lms_platform_origin', platformOrigin);
  }

  if (viewerRole === 'teacher' || viewerRole === 'admin' || viewerRole === 'student') {
    localStorage.setItem('lms_user_role', viewerRole);
    localStorage.setItem('lms_viewer_role', viewerRole);
  }

  sessionStorage.setItem(APPLIED_HANDOFF_KEY, String(data.handoffId));
  startFreshChildSession();

  try {
    if (event?.source && typeof event.source.postMessage === 'function') {
      event.source.postMessage(
        { type: LMS_ACK_TYPE, handoffId: data.handoffId },
        event.origin,
      );
    }
  } catch (err) {
    console.warn('Could not post handoff ACK back to opener:', err);
  }

  return true;
}

function announceReadyForRefresh(opener) {
  for (const origin of ALLOWED_PLATFORM_ORIGINS) {
    try {
      opener.postMessage({ type: LMS_READY_TYPE }, origin);
    } catch {
      // Ignore origins that are not the opener's current origin.
    }
  }
}

export function requestFreshLmsHandoff(timeoutMs = 4000) {
  if (refreshPromise) return refreshPromise;

  const opener = window.opener;
  if (!opener) return Promise.resolve(false);

  refreshPromise = new Promise((resolve) => {
    let settled = false;
    let readyTimer = null;
    let timeoutId = null;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', handleMessage);
      if (readyTimer) window.clearInterval(readyTimer);
      if (timeoutId) window.clearTimeout(timeoutId);
      window.__algoSecureLmsHandoffPending = false;
      resolve(value);
    };

    const handleMessage = (event) => {
      if (event.source !== opener || !ALLOWED_PLATFORM_ORIGINS.has(event.origin)) return;

      const data = event.data || {};
      if (data.type !== LMS_HANDOFF_TYPE || !data.handoffId || !data.context) return;

      try {
        receiveSecureLmsHandoff(event);
        finish(true);
      } catch (error) {
        console.error('Fresh LMS handoff could not be applied:', error);
      }
    };

    window.__algoSecureLmsHandoffPending = true;
    window.addEventListener('message', handleMessage);
    announceReadyForRefresh(opener);
    readyTimer = window.setInterval(() => announceReadyForRefresh(opener), 450);
    timeoutId = window.setTimeout(() => finish(false), timeoutMs);
  }).finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

export function installSecureLmsHandoffReceiver() {
  installTabIsolatedLmsStorage();

  if (window.__algoSecureLmsHandoffInstalled) return;
  window.__algoSecureLmsHandoffInstalled = true;

  const opener = window.opener;
  if (!opener) return;

  if (sessionStorage.getItem(APPLIED_HANDOFF_KEY)) {
    if (sessionStorage.getItem(CHILD_SESSION_EXPIRED_KEY) === '1') {
      sessionStorage.removeItem(APPLIED_HANDOFF_KEY);
    } else {
      return;
    }
  }

  prepareExpiredSessionForHandoff();
  window.__algoSecureLmsHandoffPending = true;

  let readyTimer;
  let handoffApplied = false;

  const announceReady = () => {
    for (const origin of ALLOWED_PLATFORM_ORIGINS) {
      try {
        opener.postMessage({ type: LMS_READY_TYPE }, origin);
      } catch {
        // Ignore origins that are not the opener's current origin.
      }
    }
  };

  const handleMessage = (event) => {
    if (event.source !== opener || !ALLOWED_PLATFORM_ORIGINS.has(event.origin)) return;

    const data = event.data || {};
    if (data.type !== LMS_HANDOFF_TYPE || !data.handoffId || !data.context) return;

    try {
      receiveSecureLmsHandoff(event);
      handoffApplied = true;
      window.__algoSecureLmsHandoffPending = false;

      window.removeEventListener('message', handleMessage);
      if (readyTimer) window.clearInterval(readyTimer);
      window.location.reload();
    } catch (error) {
      console.error('Secure LMS handoff could not be applied:', error);
    }
  };

  window.addEventListener('message', handleMessage);
  announceReady();
  readyTimer = window.setInterval(announceReady, 450);
  window.setTimeout(() => {
    if (readyTimer) window.clearInterval(readyTimer);
    if (!handoffApplied) {
      window.__algoSecureLmsHandoffPending = false;
    }
  }, 12000);
}
