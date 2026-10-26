import { useEffect, useMemo, useRef, useState } from 'react';
import StudentHomeDashboard from './pages/StudentHomeDashboard.jsx';
import TeacherDashboard from './pages/TeacherDashboard.jsx';
import generatedPageRegistry from './generated-pages/registry.js';

const DEFAULT_COURSE_ID = 'CK';
// The CK2 LMS serves lesson assets under /courses/CK, but schedules are recorded as CK2.
const LMS_SCHEDULE_COURSE_CODE = 'CK2';

// Synchronously persist session query parameters on first load (e.g. incognito window or direct URL redirect)
(function initSessionFromUrl() {
  if (typeof window === 'undefined') return;
  try {
    const params = new URLSearchParams(window.location.search);
    const email = params.get('studentEmail') || params.get('email');
    const incomingCourseId = params.get('courseId');
    const supabaseUrl = params.get('supabaseUrl');
    const supabaseKey = params.get('supabaseKey');
    const accessToken = params.get('accessToken');
    const backendUrl = params.get('backendUrl');

    if (email) localStorage.setItem('lms_student_email', email.trim().toLowerCase());
    if (incomingCourseId) localStorage.setItem('lms_course_id', incomingCourseId);
    if (supabaseUrl) localStorage.setItem('lms_supabase_url', supabaseUrl);
    if (supabaseKey) localStorage.setItem('lms_supabase_key', supabaseKey);
    if (accessToken) {
      localStorage.setItem('lms_access_token', accessToken);
      sessionStorage.setItem('lms_access_token', accessToken);
    }
    if (backendUrl) localStorage.setItem('lms_backend_url', backendUrl);
  } catch {}
})();

function getRouteFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    courseId: params.get('course') || DEFAULT_COURSE_ID,
    lessonId: params.get('lesson') || '',
    pageId: params.get('page') || '',
  };
}

function generatedKey(courseId, lessonId, pageId) {
  return courseId && lessonId && pageId ? `${courseId}/${lessonId}/${pageId}` : '';
}

function supabaseHeaders(key, token) {
  const headers = { apikey: key };
  const normalizedToken = String(token || '').trim();

  if (
    normalizedToken &&
    normalizedToken !== key &&
    normalizedToken.split('.').length === 3
  ) {
    headers.Authorization = `Bearer ${normalizedToken}`;
  } else if (key) {
    headers.Authorization = `Bearer ${key}`;
  }

  return headers;
}


function lessonOrderValue(lesson) {
  const id = String(lesson?.id || lesson?.lessonId || '');
  if (/aftergrad|graduation/i.test(id)) return 999999;
  const moduleNo = Number(id.match(/_M(\d+)/i)?.[1] || id.match(/M(\d+)/i)?.[1] || 900);
  const lessonNo = Number(id.match(/L(\d+)/i)?.[1] || 900);
  return moduleNo * 1000 + lessonNo;
}

function getPageIdentifier(page) {
  return String(page?.id || page?.pageId || '').trim();
}

const CHILD_SESSION_DURATION_MS = 60 * 60 * 1000;
const CHILD_SESSION_CHECK_INTERVAL_MS = 1000;
const CHILD_SESSION_DEADLINE_KEY = 'algo_child_session_deadline';
const CHILD_SESSION_EXPIRED_KEY = 'algo_child_session_expired';

const MAIN_LOGIN_URL =
  import.meta.env.VITE_MAIN_LOGIN_URL ||
  'https://learn.algo.edu.vn';

const COURSE_MODULE_ORDER = {
  CK: [
    'CK_M3L1', 'CK_M3L2', 'CK_M3L3', 'CK_M3L4',
    'CK_M4L1', 'CK_M4L2', 'CK_M4L3', 'CK_M4L4',
    'CK_M5L1', 'CK_M5L2', 'CK_M5L3', 'CK_M5L4',
    'CK_M6L1', 'CK_M6L2', 'CK_M6L3', 'CK_M6L4',
    'CK_M7L1', 'CK_M7L2', 'CK_M7L3', 'CK_M7L4',
    'CK_M8L1', 'CK_M8L2', 'CK_M8L3', 'CK_M8L4',
  ],
};

function getStoredLessonNumber(pageId) {
  try {
    const rawStructure = sessionStorage.getItem(
      'lms-global-lessons-data',
    );

    if (!rawStructure) return null;

    const modules = JSON.parse(rawStructure);

    if (!Array.isArray(modules)) return null;

    for (const module of modules) {
      for (const lesson of module?.lessons || []) {
        const containsPage = (lesson?.pages || []).some(
          (page) => getPageIdentifier(page) === pageId,
        );

        if (containsPage) {
          const lessonNumber = Number(lesson.number);

          return Number.isInteger(lessonNumber) &&
            lessonNumber > 0
            ? lessonNumber
            : null;
        }
      }
    }
  } catch (error) {
    console.warn(
      'Could not read cached lesson structure:',
      error,
    );
  }

  return null;
}

async function getLessonNumberFromCourseFiles(
  courseId,
  pageId,
) {
  const normalizedCourseId = String(courseId || '')
    .trim()
    .toUpperCase();

  if (!normalizedCourseId || !pageId) return null;

  const courseResponse = await fetch(
    `/courses/${encodeURIComponent(
      normalizedCourseId,
    )}/index.json`,
  );

  if (!courseResponse.ok) {
    throw new Error(
      `Cannot load course structure: ${courseResponse.status}`,
    );
  }

  const courseIndex = await courseResponse.json();

  const modules = Array.isArray(courseIndex?.lessons)
    ? [...courseIndex.lessons]
    : [];

  const preferredOrder =
    COURSE_MODULE_ORDER[normalizedCourseId] ||
    modules.map((module) => module.id);

  modules.sort((a, b) => {
    const indexA = preferredOrder.indexOf(a.id);
    const indexB = preferredOrder.indexOf(b.id);

    if (indexA === -1 && indexB === -1) return 0;
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;

    return indexA - indexB;
  });

  const moduleDetails = await Promise.all(
    modules.map(async (module) => {
      const response = await fetch(
        `/courses/${encodeURIComponent(
          normalizedCourseId,
        )}/${encodeURIComponent(module.id)}/index.json`,
      );

      if (!response.ok) {
        throw new Error(
          `Cannot load module ${module.id}: ${response.status}`,
        );
      }

      return response.json();
    }),
  );

  let globalLessonNumber = 1;

  for (const [moduleIndex, module] of modules.entries()) {
    const moduleData = moduleDetails[moduleIndex] || {};

    const pages = Array.isArray(moduleData.pages)
      ? moduleData.pages
      : [];

    const lessonGroups = {};

    pages.forEach((page) => {
      const rawId = getPageIdentifier(page);

      const match = rawId.match(
        /(.+?_M\d+L\d+|Graduation_M\d+L\d+)(?:_|$)/i,
      );

      const groupKey = match
        ? match[1]
        : rawId.split('_').slice(0, 2).join('_') ||
        'lesson';

      if (!lessonGroups[groupKey]) {
        lessonGroups[groupKey] = [];
      }

      lessonGroups[groupKey].push(page);
    });

    const sortedLessonGroups = Object.entries(
      lessonGroups,
    ).sort(([keyA], [keyB]) => {
      const lessonA = Number(
        keyA.match(/L(\d+)/i)?.[1] || 0,
      );

      const lessonB = Number(
        keyB.match(/L(\d+)/i)?.[1] || 0,
      );

      return lessonA - lessonB;
    });

    for (const [, lessonPages] of sortedLessonGroups) {
      const containsPage = lessonPages.some(
        (page) => getPageIdentifier(page) === pageId,
      );

      if (containsPage) {
        return globalLessonNumber;
      }

      globalLessonNumber += 1;
    }
  }

  return null;
}

async function resolvePageLessonNumber(courseId, pageId) {
  const cachedLessonNumber =
    getStoredLessonNumber(pageId);

  if (cachedLessonNumber) {
    return cachedLessonNumber;
  }

  return getLessonNumberFromCourseFiles(
    courseId,
    pageId,
  );
}

export default function App() {
  const initialRoute = getRouteFromUrl();

  const [courseId, setCourseId] = useState(
    initialRoute.courseId,
  );

  const [lessonId, setLessonId] = useState(
    initialRoute.lessonId,
  );

  const [pageId, setPageId] = useState(
    initialRoute.pageId,
  );

  // Role checking state
  const [role, setRole] = useState('student');
  const [loadingRole, setLoadingRole] =
    useState(true);

  // Student page access guard
  const [pageAccessStatus, setPageAccessStatus] =
    useState(
      initialRoute.pageId ? 'checking' : 'idle',
    );

  const lastBlockedRouteRef = useRef('');
  const sessionRedirectStartedRef = useRef(false);

  const generatedPageKey = useMemo(
    () =>
      generatedKey(
        courseId,
        lessonId,
        pageId,
      ),
    [courseId, lessonId, pageId],
  );

  const GeneratedPage =
    generatedPageRegistry[generatedPageKey] || null;

  useEffect(() => {
    const params = new URLSearchParams(
      window.location.search,
    );

    const email = params.get('studentEmail');
    const incomingCourseId = params.get('courseId');
    const supabaseUrl = params.get('supabaseUrl');
    const supabaseKey = params.get('supabaseKey');
    const accessToken = params.get('accessToken');
    const backendUrl = params.get('backendUrl');
    const storedEmail = String(
      localStorage.getItem('lms_student_email') || '',
    ).trim().toLowerCase();
    const storedSupabaseUrl = String(
      localStorage.getItem('lms_supabase_url') || '',
    ).trim();
    const storedSupabaseKey = String(
      localStorage.getItem('lms_supabase_key') || '',
    ).trim();
    const storedAccessToken = String(
      sessionStorage.getItem('lms_access_token') ||
      localStorage.getItem('lms_access_token') ||
      '',
    ).trim();

    const hasJwt = (value) =>
      Boolean(value && value.split('.').length === 3);

    const hasStoredSession = Boolean(
      storedEmail &&
      storedEmail !== 'guest@algo.edu.vn' &&
      storedSupabaseUrl &&
      storedSupabaseKey &&
      hasJwt(storedAccessToken),
    );

    const secureHandoffPending =
      window.__algoSecureLmsHandoffPending === true;

    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.startsWith('192.168.') ||
      window.location.hostname.startsWith('10.') ||
      window.location.hostname.startsWith('172.16.');

    if (!hasStoredSession) {
      if (secureHandoffPending) {
        return;
      }

      if (!isLocalhost) {
        const separator = MAIN_LOGIN_URL.includes('?') ? '&' : '?';
        window.location.replace(
          `${MAIN_LOGIN_URL}${separator}session=required`,
        );
        return;
      }
    }


    const hasIncomingSessionPayload = Boolean(
      email ||
      incomingCourseId ||
      supabaseUrl ||
      supabaseKey ||
      accessToken ||
      backendUrl,
    );

    /*
     * Mỗi redirect mới từ trang chính sang project con
     * sẽ bắt đầu một deadline mới là 1 giờ.
     *
     * Refresh project con không reset deadline vì deadline
     * được giữ trong sessionStorage của project con.
     */
    if (hasIncomingSessionPayload) {
      const nextDeadline =
        Date.now() + CHILD_SESSION_DURATION_MS;

      sessionStorage.setItem(
        CHILD_SESSION_DEADLINE_KEY,
        String(nextDeadline),
      );

      sessionStorage.removeItem(
        CHILD_SESSION_EXPIRED_KEY,
      );

      sessionRedirectStartedRef.current = false;
    }

    if (email) {
      localStorage.setItem(
        'lms_student_email',
        email,
      );
    } else if (
      !localStorage.getItem('lms_student_email')
    ) {
      localStorage.setItem(
        'lms_student_email',
        'guest@algo.edu.vn',
      );
    }

    if (incomingCourseId) {
      localStorage.setItem(
        'lms_course_id',
        incomingCourseId,
      );
    }

    if (supabaseUrl) {
      localStorage.setItem(
        'lms_supabase_url',
        supabaseUrl,
      );
    }

    if (supabaseKey) {
      localStorage.setItem(
        'lms_supabase_key',
        supabaseKey,
      );
    }

    if (accessToken) {
      localStorage.setItem(
        'lms_access_token',
        accessToken,
      );
    }

    if (backendUrl) {
      localStorage.setItem(
        'lms_backend_url',
        backendUrl,
      );
    }

    /*
     * Chỉ xóa các query liên quan đến session khỏi thanh địa chỉ,
     * giữ lại các query routing (course, lesson, page).
     */
    if (window.location.search) {
      const params = new URLSearchParams(window.location.search);
      const sessionKeys = [
        'studentEmail',
        'courseId',
        'supabaseUrl',
        'supabaseKey',
        'accessToken',
        'backendUrl'
      ];
      
      let hasRemoved = false;
      sessionKeys.forEach(key => {
        if (params.has(key)) {
          params.delete(key);
          hasRemoved = true;
        }
      });

      // Also clean up completely empty search strings that might just be `?`
      if (hasRemoved || !params.toString()) {
        const newSearch = params.toString();
        const cleanUrl =
          window.location.protocol +
          '//' +
          window.location.host +
          window.location.pathname +
          (newSearch ? '?' + newSearch : '');

        window.history.replaceState(
          {
            path: cleanUrl,
          },
          '',
          cleanUrl,
        );
      }
    }

    const activeEmail =
      email ||
      localStorage.getItem('lms_student_email') ||
      'guest@algo.edu.vn';

    const activeUrl =
      supabaseUrl ||
      localStorage.getItem('lms_supabase_url');

    const activeKey =
      supabaseKey ||
      localStorage.getItem('lms_supabase_key');

    const activeToken =
      accessToken ||
      localStorage.getItem('lms_access_token') ||
      '';

    if (activeUrl && activeKey && activeEmail) {
      async function determineRole() {
        let parsedRole = 'student';

        try {
          const profileUrl =
            `${activeUrl}/rest/v1/user_profiles` +
            `?email=eq.${encodeURIComponent(
              activeEmail,
            )}` +
            '&select=role';

          const profileRes = await fetch(
            profileUrl,
            {
              headers: supabaseHeaders(
                activeKey,
                activeToken,
              ),
            },
          );

          if (profileRes.ok) {
            const profileData =
              await profileRes.json();

            if (
              profileData &&
              profileData[0] &&
              profileData[0].role
            ) {
              parsedRole = String(
                profileData[0].role,
              )
                .toLowerCase()
                .trim();
            }
          }
        } catch (error) {
          console.warn(
            'LMS user_profiles check failed:',
            error,
          );
        }

        /*
         * Fallback: kiểm tra người dùng có role teacher
         * trong classroom_course_members hay không.
         */
        if (parsedRole === 'student') {
          try {
            const memberUrl =
              `${activeUrl}/rest/v1/classroom_course_members` +
              `?email=eq.${encodeURIComponent(
                activeEmail,
              )}` +
              '&role=eq.teacher&select=role';

            const memberRes = await fetch(
              memberUrl,
              {
                headers: supabaseHeaders(
                  activeKey,
                  activeToken,
                ),
              },
            );

            if (memberRes.ok) {
              const memberData =
                await memberRes.json();

              if (
                Array.isArray(memberData) &&
                memberData.length > 0
              ) {
                parsedRole = 'teacher';
              }
            }
          } catch (error) {
            console.warn(
              'LMS classroom_course_members check failed:',
              error,
            );
          }
        }

        /*
         * Heuristic fallback cho những account cũ
         * chưa có role đúng trong database.
         */
        if (parsedRole === 'student') {
          const handoffRole = String(
            localStorage.getItem('lms_viewer_role') || '',
          ).trim().toLowerCase();
          const handoffApplied = Boolean(
            sessionStorage.getItem('algo_lms_secure_handoff_applied'),
          );

          if (
            handoffApplied &&
            (handoffRole === 'teacher' || handoffRole === 'admin')
          ) {
            parsedRole = handoffRole;
          }
        }

        console.log(
          'LMS final parsed user role:',
          parsedRole,
        );

        localStorage.setItem(
          'lms_user_role',
          parsedRole,
        );

        setRole(parsedRole);
        setLoadingRole(false);
      }

      determineRole();
    } else {
      let parsedRole = 'student';

      const handoffRole = String(
        localStorage.getItem('lms_viewer_role') || '',
      ).trim().toLowerCase();
      const handoffApplied = Boolean(
        sessionStorage.getItem('algo_lms_secure_handoff_applied'),
      );

      if (
        handoffApplied &&
        activeToken &&
        activeToken.split('.').length === 3 &&
        (handoffRole === 'teacher' || handoffRole === 'admin')
      ) {
        parsedRole = handoffRole;
      }

      const viewerRole = (localStorage.getItem('lms_viewer_role') || '').trim().toLowerCase();
      if (viewerRole === 'teacher' || viewerRole === 'admin') {
        parsedRole = viewerRole;
      }

      console.log(
        'LMS final parsed user role (heuristic fallback):',
        parsedRole,
      );

      localStorage.setItem(
        'lms_user_role',
        parsedRole,
      );

      setRole(parsedRole);
      setLoadingRole(false);
    }
  }, []);

  /*
   * Timer riêng của project con.
   *
   * Chỉ chạy cho student.
   * Teacher và admin không bị timeout.
   */
  useEffect(() => {
    if (loadingRole || role !== 'student') {
      return;
    }

    sessionRedirectStartedRef.current = false;

    function redirectToMainLogin() {
      if (sessionRedirectStartedRef.current) {
        return;
      }

      sessionRedirectStartedRef.current = true;

      sessionStorage.removeItem(
        CHILD_SESSION_DEADLINE_KEY,
      );

      sessionStorage.setItem(
        CHILD_SESSION_EXPIRED_KEY,
        '1',
      );

      /*
       * Xóa thông tin đăng nhập đã được chuyển từ
       * trang chính sang project con.
       */
      localStorage.removeItem(
        'lms_student_email',
      );

      localStorage.removeItem('lms_course_id');

      localStorage.removeItem(
        'lms_supabase_url',
      );

      localStorage.removeItem(
        'lms_supabase_key',
      );

      localStorage.removeItem(
        'lms_access_token',
      );

      localStorage.removeItem(
        'lms_backend_url',
      );

      localStorage.removeItem('lms_user_role');

      const separator = MAIN_LOGIN_URL.includes('?')
        ? '&'
        : '?';

      window.location.replace(
        `${MAIN_LOGIN_URL}${separator}session=expired`,
      );
    }

    /*
     * Nếu session đã hết, sử dụng nút Back không được
     * tự động bắt đầu thêm một giờ mới.
     *
     * Chỉ một redirect mới từ trang chính có query session
     * mới xóa expired marker.
     */
    if (
      sessionStorage.getItem(
        CHILD_SESSION_EXPIRED_KEY,
      ) === '1'
    ) {
      redirectToMainLogin();
      return;
    }

    const storedValue =
      sessionStorage.getItem(
        CHILD_SESSION_DEADLINE_KEY,
      );

    const storedDeadline = storedValue
      ? Number(storedValue)
      : Number.NaN;

    /*
     * Chưa có deadline thì bắt đầu tính một giờ
     * kể từ lúc student mở project con.
     */
    const deadline =
      Number.isFinite(storedDeadline) &&
        storedDeadline > 0
        ? storedDeadline
        : Date.now() + CHILD_SESSION_DURATION_MS;

    sessionStorage.setItem(
      CHILD_SESSION_DEADLINE_KEY,
      String(deadline),
    );

    function checkSessionDeadline() {
      if (Date.now() >= deadline) {
        redirectToMainLogin();
      }
    }

    function handleVisibilityChange() {
      if (
        document.visibilityState === 'visible'
      ) {
        checkSessionDeadline();
      }
    }

    checkSessionDeadline();

    const intervalId = window.setInterval(
      checkSessionDeadline,
      CHILD_SESSION_CHECK_INTERVAL_MS,
    );

    window.addEventListener(
      'focus',
      checkSessionDeadline,
    );

    document.addEventListener(
      'visibilitychange',
      handleVisibilityChange,
    );

    return () => {
      window.clearInterval(intervalId);

      window.removeEventListener(
        'focus',
        checkSessionDeadline,
      );

      document.removeEventListener(
        'visibilitychange',
        handleVisibilityChange,
      );
    };
  }, [loadingRole, role]);

  useEffect(() => {
    function handlePopState() {
      const nextRoute = getRouteFromUrl();

      setCourseId(nextRoute.courseId);
      setLessonId(nextRoute.lessonId);
      setPageId(nextRoute.pageId);

      setPageAccessStatus(
        nextRoute.pageId ? 'checking' : 'idle',
      );
    }

    window.addEventListener(
      'popstate',
      handlePopState,
    );

    return () => {
      window.removeEventListener(
        'popstate',
        handlePopState,
      );
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function verifyPageAccess() {
      if (loadingRole) return;

      if (!courseId || !pageId) {
        setPageAccessStatus('idle');
        return;
      }

      /*
       * Teacher và admin được preview mọi page.
       */
      if (
        role === 'teacher' ||
        role === 'admin'
      ) {
        setPageAccessStatus('allowed');
        return;
      }

      setPageAccessStatus('checking');

      const normalizedCourseId = String(
        courseId,
      )
        .trim()
        .toUpperCase();

      const normalizedEmail = String(
        localStorage.getItem(
          'lms_student_email',
        ) || 'guest@algo.edu.vn',
      )
        .trim()
        .toLowerCase();

      const supabaseUrl =
        localStorage.getItem(
          'lms_supabase_url',
        );

      const supabaseKey =
        localStorage.getItem(
          'lms_supabase_key',
        );

      const accessToken =
        localStorage.getItem(
          'lms_access_token',
        ) || '';

      const blockPage = (
        lessonNumber,
        reason,
      ) => {
        if (cancelled) return;

        const message = lessonNumber
          ? `Lesson ${lessonNumber} is locked. It will open when your class reaches this lesson.`
          : 'This lesson is locked or its access could not be verified.';

        const blockedRoute =
          `${normalizedCourseId}/` +
          `${lessonId}/${pageId}`;

        setPageAccessStatus('denied');

        const nextUrl =
          `/?course=${encodeURIComponent(
            normalizedCourseId,
          )}`;

        window.history.replaceState(
          {},
          '',
          nextUrl,
        );

        setLessonId('');
        setPageId('');

        if (
          lastBlockedRouteRef.current !==
          blockedRoute
        ) {
          lastBlockedRouteRef.current =
            blockedRoute;

          window.setTimeout(() => {
            window.alert(
              reason
                ? `${message}\n\n${reason}`
                : message,
            );
          }, 0);
        }
      };

      try {
        const lessonNumber =
          await resolvePageLessonNumber(
            normalizedCourseId,
            pageId,
          );

        if (cancelled) return;

        if (!lessonNumber) {
          blockPage(
            null,
            'The page could not be matched to the course structure.',
          );
          return;
        }

        /*
         * Lesson 1 và 2 mặc định luôn mở.
         */
        if (lessonNumber <= 2) {
          setPageAccessStatus('allowed');
          return;
        }

        if (
          !supabaseUrl ||
          !supabaseKey ||
          !normalizedEmail ||
          normalizedEmail ===
          'guest@algo.edu.vn'
        ) {
          blockPage(
            lessonNumber,
            'Sign in through the learning platform to verify access.',
          );
          return;
        }

        const unlockUrl =
          `${supabaseUrl}/rest/v1/student_lesson_schedules` +
          `?student_email=eq.${encodeURIComponent(
            normalizedEmail,
          )}` +
          `&lms_course_id=eq.${encodeURIComponent(
            LMS_SCHEDULE_COURSE_CODE,
          )}` +
          '&select=topic_id';

        const response = await fetch(
          unlockUrl,
          {
            headers: {
              apikey: supabaseKey,
              ...(
                accessToken &&
                  accessToken
                    .split('.')
                    .length === 3
                  ? {
                    Authorization:
                      `Bearer ${accessToken}`,
                  }
                  : {}
              ),
            },
          },
        );

        if (!response.ok) {
          throw new Error(
            `Lesson access lookup failed: ${response.status}`,
          );
        }

        const rows = await response.json();

        let highestUnlockedLesson = 2;

        if (Array.isArray(rows)) {
          rows.forEach((row) => {
            const unlockedLesson = Number(
              row.topic_id,
            );

            if (
              Number.isInteger(
                unlockedLesson,
              ) &&
              unlockedLesson >
              highestUnlockedLesson
            ) {
              highestUnlockedLesson =
                unlockedLesson;
            }
          });
        }

        if (
          lessonNumber <=
          highestUnlockedLesson
        ) {
          lastBlockedRouteRef.current = '';

          setPageAccessStatus('allowed');
          return;
        }

        blockPage(lessonNumber);
      } catch (error) {
        console.warn(
          'LMS page access verification failed:',
          error,
        );

        blockPage(
          null,
          'Please return to the dashboard and try again.',
        );
      }
    }

    verifyPageAccess();

    return () => {
      cancelled = true;
    };
  }, [
    courseId,
    lessonId,
    pageId,
    role,
    loadingRole,
  ]);

  function openPage(nextLessonId, nextPageId) {
    if (!nextLessonId || !nextPageId) return;

    try {
      localStorage.setItem('algo_last_visited_lesson', nextLessonId);
    } catch {}

    const nextUrl =
      `/?course=${encodeURIComponent(
        courseId,
      )}` +
      `&lesson=${encodeURIComponent(
        nextLessonId,
      )}` +
      `&page=${encodeURIComponent(
        nextPageId,
      )}`;

    window.history.pushState(
      {},
      '',
      nextUrl,
    );

    setPageAccessStatus('checking');
    setLessonId(nextLessonId);
    setPageId(nextPageId);
  }

  function backToDashboard(targetLessonId) {
    let activeLessonId =
      typeof targetLessonId === 'string' && targetLessonId.trim()
        ? targetLessonId.trim()
        : '';

    if (!activeLessonId && typeof lessonId === 'string' && lessonId.trim()) {
      activeLessonId = lessonId.trim();
    }

    if (!activeLessonId) {
      try {
        const storedLesson =
          localStorage.getItem('lms_current_lesson_id') ||
          localStorage.getItem('algo_last_visited_lesson') ||
          '';
        if (storedLesson && typeof storedLesson === 'string') {
          activeLessonId = storedLesson.trim();
        }
      } catch {}
    }

    const nextUrl = activeLessonId
      ? `/?course=${encodeURIComponent(courseId || DEFAULT_COURSE_ID)}&lesson=${encodeURIComponent(activeLessonId)}`
      : `/?course=${encodeURIComponent(courseId || DEFAULT_COURSE_ID)}`;

    window.history.pushState(
      {},
      '',
      nextUrl,
    );

    setLessonId(activeLessonId);
    setPageId('');
    setPageAccessStatus('idle');
  }

  if (loadingRole) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily:
            'Nunito, Arial, sans-serif',
          background: '#faf8ff',
          color: '#7c22d4',
        }}
      >
        <h2>
          Getting your learning space ready...
        </h2>

        <p>Please wait a moment.</p>
      </div>
    );
  }

  /*
   * TeacherDashboard chỉ render khi teacher/admin
   * không preview một generated page cụ thể.
   */
  if (
    (role === 'teacher' ||
      role === 'admin') &&
    !pageId
  ) {
    return <TeacherDashboard initialCourseId={courseId} initialLessonId={lessonId} onOpenPage={openPage} />;
  }

  if (
    pageId &&
    role === 'student' &&
    pageAccessStatus !== 'allowed'
  ) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily:
            'Nunito, Arial, sans-serif',
          background: '#faf8ff',
          color: '#7c22d4',
        }}
      >
        <h2>Checking lesson access...</h2>
        <p>Please wait a moment.</p>
      </div>
    );
  }

  if (!pageId) {
    return (
      <StudentHomeDashboard
        initialCourseId={courseId}
        courseId={courseId}
        initialLessonId={lessonId}
        studentEmail={
          localStorage.getItem('lms_student_email') ||
          sessionStorage.getItem('lms_student_email') ||
          new URLSearchParams(window.location.search).get('studentEmail') ||
          ''
        }
        supabaseUrl={
          localStorage.getItem('lms_supabase_url') ||
          sessionStorage.getItem('lms_supabase_url') ||
          new URLSearchParams(window.location.search).get('supabaseUrl') ||
          ''
        }
        supabaseKey={
          localStorage.getItem('lms_supabase_key') ||
          sessionStorage.getItem('lms_supabase_key') ||
          new URLSearchParams(window.location.search).get('supabaseKey') ||
          ''
        }
        onOpenPage={openPage}
      />
    );
  }

  if (GeneratedPage) {
    return (
      <GeneratedPage
        courseId={courseId}
        lessonId={lessonId}
        pageId={pageId}
        onBackToPages={backToDashboard}
        onBackToLessons={backToDashboard}
        onBackToCourses={backToDashboard}
      />
    );
  }

  return (
    <main
      className="empty-screen"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'sans-serif',
      }}
    >
      <h1>404 - Page Not Found</h1>

      <p>
        The requested page <strong>{pageId}</strong> could not be found.
      </p>

      <button
        type="button"
        onClick={backToDashboard}
        style={{
          marginTop: '20px',
          padding: '10px 20px',
          background: '#3b82f6',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      >
        Back to Dashboard
      </button>
    </main>
  );
}
