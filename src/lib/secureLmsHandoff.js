// Authentication context must be scoped to this browser tab. The LMS codebase
// still reads these legacy keys through localStorage, so redirect only those
// keys to sessionStorage while leaving all unrelated application storage alone.
const TAB_SCOPED_LMS_KEYS = new Set([
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
]);

function installTabIsolatedLmsStorage() {
  if (typeof window === 'undefined' || window.__algoTabIsolatedLmsStorageInstalled) return;

  const storagePrototype = window.Storage.prototype;
  const nativeGetItem = storagePrototype.getItem;
  const nativeSetItem = storagePrototype.setItem;
  const nativeRemoveItem = storagePrototype.removeItem;
  const nativeClear = storagePrototype.clear;
  const localStore = window.localStorage;
  const tabStore = window.sessionStorage;

  storagePrototype.getItem = function getItem(key) {
    const normalizedKey = String(key);
    if (this === localStore && TAB_SCOPED_LMS_KEYS.has(normalizedKey)) {
      return nativeGetItem.call(tabStore, normalizedKey);
    }
    return nativeGetItem.call(this, normalizedKey);
  };

  storagePrototype.setItem = function setItem(key, value) {
    const normalizedKey = String(key);
    if (this === localStore && TAB_SCOPED_LMS_KEYS.has(normalizedKey)) {
      return nativeSetItem.call(tabStore, normalizedKey, String(value));
    }
    return nativeSetItem.call(this, normalizedKey, String(value));
  };

  storagePrototype.removeItem = function removeItem(key) {
    const normalizedKey = String(key);
    if (this === localStore && TAB_SCOPED_LMS_KEYS.has(normalizedKey)) {
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
    nativeRemoveItem.call(localStore, key);
  }

  window.__algoTabIsolatedLmsStorageInstalled = true;
}

function clearTabScopedLmsContext() {
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

installTabIsolatedLmsStorage();

const LMS_HANDOFF_TYPE = 'ALGO_LMS_HANDOFF';
const LMS_READY_TYPE = 'ALGO_LMS_READY';
const LMS_ACK_TYPE = 'ALGO_LMS_HANDOFF_ACK';
const APPLIED_HANDOFF_KEY = 'algo_lms_secure_handoff_applied';

const CHILD_SESSION_DURATION_MS = 60 * 60 * 1000;
const HANDOFF_RECOVERY_GRACE_MS = 15 * 1000;
const CHILD_SESSION_DEADLINE_KEY = 'algo_child_session_deadline';
const CHILD_SESSION_EXPIRED_KEY = 'algo_child_session_expired';

const ALLOWED_PLATFORM_ORIGINS = new Set([
  'https://learn.algo.edu.vn',
  'https://learn.algorithmics.edu.vn',
  'https://learn.algorithmics.com.vn',
  'http://localhost:5173',
  'http://localhost:5174',
]);

function normalize(value) {
  return String(value || '').trim();
}

function startFreshChildSession(durationMs = CHILD_SESSION_DURATION_MS) {
  sessionStorage.setItem(CHILD_SESSION_DEADLINE_KEY, String(Date.now() + durationMs));
  sessionStorage.removeItem(CHILD_SESSION_EXPIRED_KEY);
}

function persistContext(context) {
  assertTokenMatchesContext(context);
  clearTabScopedLmsContext();
  const studentEmail = normalize(context.studentEmail || context.teacherEmail).toLowerCase();
  const teacherEmail = normalize(context.teacherEmail).toLowerCase();
  const viewerRole = normalize(context.viewerRole).toLowerCase();

  if (studentEmail) localStorage.setItem('lms_student_email', studentEmail);
  if (teacherEmail) localStorage.setItem('lms_user_email', teacherEmail);

  [
    ['lms_course_id', context.courseId],
    ['lms_supabase_url', context.supabaseUrl],
    ['lms_supabase_key', context.supabaseKey],
    ['lms_access_token', context.accessToken],
    ['lms_backend_url', context.backendUrl],
  ].forEach(([key, value]) => {
    const normalized = normalize(value);
    if (normalized) localStorage.setItem(key, normalized);
  });

  if (viewerRole) {
    localStorage.setItem('lms_user_role', viewerRole);
    localStorage.setItem('lms_viewer_role', viewerRole);
  }

  startFreshChildSession();
}

export function installSecureLmsHandoffReceiver() {
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

  if (sessionStorage.getItem(CHILD_SESSION_EXPIRED_KEY) === '1') {
    startFreshChildSession(HANDOFF_RECOVERY_GRACE_MS);
  }

  window.__algoSecureLmsHandoffPending = true;

  let timer;
  let handoffApplied = false;

  const ready = () => {
    for (const origin of ALLOWED_PLATFORM_ORIGINS) {
      try {
        opener.postMessage({ type: LMS_READY_TYPE }, origin);
      } catch {
        // Ignore origins that are not the opener's current origin.
      }
    }
  };

  const onMessage = (event) => {
    if (event.source !== opener || !ALLOWED_PLATFORM_ORIGINS.has(event.origin)) return;

    const data = event.data || {};
    if (data.type !== LMS_HANDOFF_TYPE || !data.handoffId || !data.context) return;

    persistContext(data.context);
    handoffApplied = true;
    window.__algoSecureLmsHandoffPending = false;
    sessionStorage.setItem(APPLIED_HANDOFF_KEY, String(data.handoffId));

    event.source.postMessage(
      { type: LMS_ACK_TYPE, handoffId: data.handoffId },
      event.origin,
    );

    window.removeEventListener('message', onMessage);
    if (timer) window.clearInterval(timer);
    window.location.reload();
  };

  window.addEventListener('message', onMessage);
  ready();
  timer = window.setInterval(ready, 450);

  window.setTimeout(() => {
    if (timer) window.clearInterval(timer);
    if (!handoffApplied) window.__algoSecureLmsHandoffPending = false;
  }, 12000);
}
