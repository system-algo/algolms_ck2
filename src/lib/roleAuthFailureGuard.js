import { getMainPlatformUrl } from './authConfig';
const MAIN_LOGIN_URL = getMainPlatformUrl();

function normalize(value) {
  return String(value || '').trim();
}

function isJwt(value) {
  return Boolean(value && value.split('.').length === 3);
}

function isRoleProbe(url) {
  const path = url.pathname;

  if (path.endsWith('/rest/v1/user_profiles')) {
    const select = String(url.searchParams.get('select') || '');
    return select.split(',').map((value) => value.trim()).includes('role');
  }

  if (path.endsWith('/rest/v1/classroom_course_members')) {
    const roleFilter = String(url.searchParams.get('role') || '').toLowerCase();
    const select = String(url.searchParams.get('select') || '');
    return roleFilter === 'eq.teacher' && select.split(',').map((value) => value.trim()).includes('role');
  }

  return false;
}

export function getHandoffRoleResponse(url) {
  if (!isRoleProbe(url)) return null;

  const accessToken = normalize(localStorage.getItem('lms_access_token'));
  const viewerRole = normalize(localStorage.getItem('lms_viewer_role')).toLowerCase();

  if (!isJwt(accessToken) || !['student', 'teacher', 'admin'].includes(viewerRole)) {
    return null;
  }

  let data;
  if (url.pathname.endsWith('/rest/v1/user_profiles')) {
    data = [{ role: viewerRole }];
  } else {
    data = viewerRole === 'teacher' ? [{ role: 'teacher' }] : [];
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-LMS-Role-Source': 'secure-handoff',
    },
  });
}

export function clearStaleRoleSession() {
  localStorage.removeItem('lms_access_token');
  localStorage.removeItem('lms_user_role');
  localStorage.removeItem('lms_viewer_role');
  sessionStorage.removeItem('algo_child_session_deadline');
  sessionStorage.setItem('algo_child_session_expired', '1');
}

function isSecureHandoffPending() {
  return window.__algoSecureLmsHandoffPending === true;
}

export function installRoleAuthFailureGuard() {
  if (window.__algoRoleAuthFailureGuardInstalled) return;
  window.__algoRoleAuthFailureGuardInstalled = true;

  const originalFetch = window.fetch.bind(window);
  let redirectStarted = false;

  window.fetch = async (input, init = {}) => {
    let url = null;
    try {
      url = new URL(typeof input === 'string' ? input : input.url, window.location.origin);
    } catch {
      return originalFetch(input, init);
    }

    // The main platform already supplied viewerRole through the trusted
    // postMessage handoff. Reuse it for UI role rendering instead of asking
    // Supabase to prove the same non-authoritative UI fact on every reload.
    // Backend authorization and RLS remain authoritative for protected data.
    const handoffResponse = getHandoffRoleResponse(url);
    if (handoffResponse) {
      return handoffResponse;
    }

    const response = await originalFetch(input, init);

    // A newly opened teacher/admin popup starts mounting before the secure
    // postMessage handoff can arrive. A 401/403 during that short window is not
    // evidence of an expired LMS session, so do not bounce the popup back to
    // the main portal. The receiver reloads once the trusted context is stored.
    if (
      !redirectStarted &&
      !isSecureHandoffPending() &&
      isRoleProbe(url) &&
      (response.status === 401 || response.status === 403)
    ) {
      redirectStarted = true;
      clearStaleRoleSession();
      const separator = MAIN_LOGIN_URL.includes('?') ? '&' : '?';
      window.setTimeout(() => {
        window.location.replace(`${MAIN_LOGIN_URL}${separator}session=expired&source=lms-role`);
      }, 0);
    }
    return response;
  };
}
