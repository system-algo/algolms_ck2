import { requestFreshLmsHandoff } from '../security/secureLmsHandoffReceiver.js';

function normalize(value) {
  return String(value || '').trim();
}

function isJwt(value) {
  return Boolean(value && value.split('.').length === 3);
}

function isWithinBaseUrl(url, baseValue) {
  if (!baseValue) return false;

  try {
    const base = new URL(baseValue);
    if (url.origin !== base.origin) return false;

    const basePath = base.pathname.replace(/\/$/, '');
    if (!basePath) return true;

    return url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);
  } catch {
    return false;
  }
}

function getConfiguredBackendUrls() {
  return [
    sessionStorage.getItem('lms_backend_url'),
    localStorage.getItem('lms_backend_url'),
    import.meta.env.VITE_API_BASE_URL,
    import.meta.env.VITE_API_URL,
  ]
    .map((value) => normalize(value).replace(/\/$/, ''))
    .filter(Boolean);
}

function getAccessToken() {
  return normalize(
    sessionStorage.getItem('lms_access_token') ||
      localStorage.getItem('lms_access_token'),
  );
}

function getRequestMethod(input, init) {
  return String(
    init?.method ||
      (input instanceof Request ? input.method : '') ||
      'GET',
  ).toUpperCase();
}

function rewriteLegacyIdeAnswerKeyUrl(url, input, init) {
  if (getRequestMethod(input, init) !== 'GET') return url;

  if (!url.pathname.endsWith('/api/admin/answer-keys')) {
    return url;
  }

  const nextUrl = new URL(url.toString());
  nextUrl.pathname = nextUrl.pathname.replace(
    /\/api\/admin\/answer-keys$/,
    '/api/answer-keys/ide',
  );
  return nextUrl;
}

function buildAuthorizedHeaders(input, init, token) {
  const headers = new Headers(
    input instanceof Request ? input.headers : undefined,
  );

  new Headers(init.headers || {}).forEach((value, key) =>
    headers.set(key, value),
  );

  headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

export function installBackendAuthFetch() {
  if (window.__algoBackendAuthFetchInstalled) return;
  window.__algoBackendAuthFetchInstalled = true;

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

    const isConfiguredBackend = getConfiguredBackendUrls().some((backendUrl) =>
      isWithinBaseUrl(url, backendUrl),
    );

    if (!isConfiguredBackend) {
      return originalFetch(input, init);
    }

    // Legacy activity maps still point IDE answer-key reads at the protected
    // admin path. Keep those reads on the learner-safe endpoint.
    url = rewriteLegacyIdeAnswerKeyUrl(url, input, init);

    const sendWithToken = (token) => {
      const requestUrl = url.toString();

      if (!isJwt(token)) {
        if (input instanceof Request) {
          return originalFetch(new Request(requestUrl, input), init);
        }
        return originalFetch(requestUrl, init);
      }

      const headers = buildAuthorizedHeaders(input, init, token);

      if (input instanceof Request) {
        return originalFetch(new Request(requestUrl, input), { ...init, headers });
      }

      return originalFetch(requestUrl, { ...init, headers });
    };

    let token = getAccessToken();

    // A popup can mount before the trusted parent handoff is ready. Ask for
    // fresh context before the first protected request instead of generating a
    // predictable 401.
    if (!isJwt(token) && window.opener) {
      const refreshed = await requestFreshLmsHandoff();
      if (refreshed) {
        token = getAccessToken();
      }
    }

    const response = await sendWithToken(token);

    // If the backend rejects a previously valid-looking token, request a fresh
    // trusted handoff and retry replay-safe string URL requests exactly once.
    if (
      response.status === 401 &&
      !(input instanceof Request) &&
      window.opener &&
      isJwt(token)
    ) {
      const refreshed = await requestFreshLmsHandoff();
      const freshToken = getAccessToken();

      if (refreshed && isJwt(freshToken) && freshToken !== token) {
        return sendWithToken(freshToken);
      }
    }

    return response;
  };
}
