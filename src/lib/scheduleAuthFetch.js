function normalize(value) {
  return String(value || '').trim();
}

function isJwt(value) {
  return Boolean(value && value.split('.').length === 3);
}

const LESSON_SCHEDULE_CACHE_TTL_MS = 5 * 60 * 1000;
const lessonScheduleCache = new Map();

function getRequestMethod(input, init) {
  return String(
    init?.method || (input instanceof Request ? input.method : 'GET') || 'GET',
  ).toUpperCase();
}

function getCachedResponse(cacheKey) {
  const entry = lessonScheduleCache.get(cacheKey);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    lessonScheduleCache.delete(cacheKey);
    return null;
  }

  return new Response(entry.body, {
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.headers,
  });
}

async function cacheSuccessfulResponse(cacheKey, response) {
  if (!response.ok) return;

  const clone = response.clone();
  const body = await clone.text();

  lessonScheduleCache.set(cacheKey, {
    body,
    status: clone.status,
    statusText: clone.statusText,
    headers: Array.from(clone.headers.entries()),
    expiresAt: Date.now() + LESSON_SCHEDULE_CACHE_TTL_MS,
  });
}

function clearScheduleCache() {
  lessonScheduleCache.clear();
}

export function installScheduleAuthFetch() {
  if (window.__algoScheduleAuthFetchInstalled) return;
  window.__algoScheduleAuthFetchInstalled = true;
  
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    let url;
    try {
      url = new URL(
        typeof input === 'string' ? input : input.url,
        window.location.origin,
      );
    } catch {
      return originalFetch(input, init);
    }

    if (!url.pathname.includes('/rest/v1/student_lesson_schedules')) {
      return originalFetch(input, init);
    }

    const token = normalize(localStorage.getItem('lms_access_token'));
    const supabaseUrl = normalize(localStorage.getItem('lms_supabase_url')).replace(/\/$/, '');

    if (!isJwt(token) || !supabaseUrl || url.origin !== new URL(supabaseUrl).origin) {
      return originalFetch(input, init);
    }

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
    headers.set('Authorization', `Bearer ${token}`);

    const method = getRequestMethod(input, init);
    const cacheKey = `${token.slice(-16)}|${url.toString()}`;

    if (method === 'GET') {
      const cached = getCachedResponse(cacheKey);
      if (cached) {
        return cached;
      }
    } else {
      // A teacher/admin mutation can change the unlock state immediately.
      clearScheduleCache();
    }

    const response = input instanceof Request
      ? await originalFetch(new Request(input, { ...init, headers }))
      : await originalFetch(url.toString(), { ...init, headers });

    if (method === 'GET') {
      await cacheSuccessfulResponse(cacheKey, response);
    }

    return response;
  };
}
