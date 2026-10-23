function normalize(value) { return String(value || '').trim(); }
function isWithinBaseUrl(url, baseValue) {
  if (!baseValue) return false;
  try {
    const base = new URL(baseValue);
    if (url.origin !== base.origin) return false;
    const basePath = base.pathname.replace(/\/$/, '');
    return !basePath || url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);
  } catch { return false; }
}
function getConfiguredBackendUrls() {
  return [sessionStorage.getItem('lms_backend_url'), localStorage.getItem('lms_backend_url'), import.meta.env.VITE_API_BASE_URL, import.meta.env.VITE_API_URL]
    .map((value) => normalize(value).replace(/\/$/, '')).filter(Boolean);
}
export function installAnswerKeyCompatFetch() {
  if (window.__algoAnswerKeyCompatFetchInstalled) return;
  window.__algoAnswerKeyCompatFetchInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    let url;
    try { url = new URL(typeof input === 'string' ? input : input.url, window.location.origin); }
    catch { return originalFetch(input, init); }
    const method = String(init?.method || (input instanceof Request ? input.method : '') || 'GET').toUpperCase();
    const isConfiguredBackend = getConfiguredBackendUrls().some((backendUrl) => isWithinBaseUrl(url, backendUrl));
    if (method === 'GET' && isConfiguredBackend && url.pathname.endsWith('/api/admin/answer-keys')) {
      const nextUrl = new URL(url.toString());
      nextUrl.pathname = nextUrl.pathname.replace(/\/api\/admin\/answer-keys$/, '/api/answer-keys/ide');
      return originalFetch(nextUrl.toString(), init);
    }
    return originalFetch(input, init);
  };
}
