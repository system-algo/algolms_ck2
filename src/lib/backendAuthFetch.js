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

export function installBackendAuthFetch() {
  if (window.__algoBackendAuthFetchInstalled) return;
  window.__algoBackendAuthFetchInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input, init = {}) => {
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

    const token = normalize(
      sessionStorage.getItem('lms_access_token') ||
        localStorage.getItem('lms_access_token'),
    );

    if (!isJwt(token)) {
      return originalFetch(input, init);
    }

    const headers = new Headers(
      input instanceof Request ? input.headers : undefined,
    );
    new Headers(init.headers || {}).forEach((value, key) =>
      headers.set(key, value),
    );
    headers.set('Authorization', `Bearer ${token}`);

    if (input instanceof Request) {
      return originalFetch(new Request(input, { ...init, headers }));
    }

    return originalFetch(input, { ...init, headers });
  };
}
