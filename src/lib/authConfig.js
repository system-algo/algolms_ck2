/**
 * Parse a comma, semicolon, or space separated list of URLs from an environment variable.
 */
function parseConfiguredUrls(envValue) {
  if (!envValue || typeof envValue !== 'string') return [];
  return envValue
    .split(/[,;\s]+/)
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * Gets all configured main portal URLs from environment variables.
 * Supports a single URL or multiple comma-separated URLs:
 * VITE_MAIN_LOGIN_URL=https://learn.algorithmics.edu.vn,https://learn.algorithmics.com.vn
 */
export function getAllConfiguredPlatformUrls() {
  const envValue = import.meta.env.VITE_MAIN_LOGIN_URL || import.meta.env.VITE_ALLOWED_PLATFORM_ORIGINS || '';
  return parseConfiguredUrls(envValue);
}

/**
 * Dynamically resolves the main LMS portal URL for the current user session:
 * 1. If running on localhost / 127.0.0.1 -> returns http://localhost:5174
 * 2. If VITE_MAIN_LOGIN_URL contains a URL matching the current host domain -> uses that
 * 3. If running on a subdomain (e.g. ptsy1.learn.domain.com) -> dynamically derives https://learn.domain.com
 * 4. Falls back to the first URL configured in VITE_MAIN_LOGIN_URL or root "/"
 */
export function getMainPlatformUrl() {
  if (typeof window !== 'undefined') {
    const { hostname, protocol } = window.location;

    // Local development
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:5174';
    }

    const configuredUrls = getAllConfiguredPlatformUrls();

    // 1. Look for a configured URL matching the current root domain
    for (const urlStr of configuredUrls) {
      try {
        const parsed = new URL(urlStr);
        const currentParent = hostname.replace(/^[^.]+\./, '');
        if (hostname.endsWith(parsed.hostname) || parsed.hostname.endsWith(currentParent)) {
          return urlStr;
        }
      } catch {}
    }

    // 2. Dynamic derivation: strip the course subdomain prefix (e.g. ptsy1.learn.xxx -> https://learn.xxx)
    const parts = hostname.split('.');
    if (parts.length >= 3) {
      const parentHost = parts.slice(1).join('.');
      return `${protocol}//${parentHost}`;
    }

    // 3. Fallback to the first configured URL
    if (configuredUrls.length > 0) {
      return configuredUrls[0];
    }
  }

  const configuredUrls = getAllConfiguredPlatformUrls();
  return configuredUrls[0] || '/';
}

/**
 * Resolves the origin (protocol + host + port) of the main portal.
 */
export function getMainPlatformOrigin() {
  const mainUrl = getMainPlatformUrl();
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5174';
    return new URL(mainUrl, base).origin;
  } catch {
    return mainUrl.replace(/\/+$/, '');
  }
}

/**
 * URL to redirect to when logging out.
 */
export function getMainPlatformSignOutUrl() {
  return `${getMainPlatformOrigin()}/auth/sign-out`;
}
