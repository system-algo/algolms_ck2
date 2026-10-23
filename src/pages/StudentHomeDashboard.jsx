import { useEffect, useMemo, useState } from 'react';
import { calculateActiveTaskCount, resolveActivityMapUrl } from '../lib/taskExtractors';
import customNames from '../config/mapping.json';
import './StudentHomeDashboard.css';

// CK2 uses CK asset routes, but its unlock schedules are stored under lms_course_id=CK2.
const LMS_SCHEDULE_COURSE_CODE = 'CK2';
const COURSE_TITLE = 'Game Development';
const NEXT_COURSE_TITLE = 'Web Development';
const PTSY1_REF = 'd8d188a37007437c047d211a0767abad1c2d0d2f';
const PTSY1_PUBLIC = `https://cdn.jsdelivr.net/gh/system-algo/algolms_ptsy1@${PTSY1_REF}/public`;
const LOGO_ASSET = '/assets/algorithmics-logo.png';
const GD_BADGE = '/course-badges/gd.png';
const WD_BADGE = '/course-badges/wd.png';

function getLessonMeta(id) {
  const raw = String(id || '');
  if (/aftergrad|graduation/i.test(raw)) return { moduleNo: 99, lessonNo: 1 };
  const moduleNo = Number(raw.match(/_M(\d+)/i)?.[1] || raw.match(/M(\d+)/i)?.[1] || 1);
  const lessonNo = Number(raw.match(/L(\d+)/i)?.[1] || 1);
  return { moduleNo, lessonNo };
}

function getSupabaseCredentials(props = {}) {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const supabaseUrl =
    props.supabaseUrl ||
    params?.get('supabaseUrl') ||
    sessionStorage.getItem('lms_supabase_url') ||
    localStorage.getItem('lms_supabase_url') ||
    '';
  const supabaseKey =
    props.supabaseKey ||
    params?.get('supabaseKey') ||
    sessionStorage.getItem('lms_supabase_key') ||
    localStorage.getItem('lms_supabase_key') ||
    '';
  const studentEmail = (
    props.studentEmail ||
    params?.get('studentEmail') ||
    params?.get('email') ||
    sessionStorage.getItem('lms_student_email') ||
    localStorage.getItem('lms_student_email') ||
    sessionStorage.getItem('lms_user_email') ||
    localStorage.getItem('lms_user_email') ||
    ''
  ).trim().toLowerCase();
  const accessToken =
    props.accessToken ||
    params?.get('accessToken') ||
    sessionStorage.getItem('lms_access_token') ||
    localStorage.getItem('lms_access_token') ||
    '';

  try {
    if (supabaseUrl && !localStorage.getItem('lms_supabase_url')) localStorage.setItem('lms_supabase_url', supabaseUrl);
    if (supabaseKey && !localStorage.getItem('lms_supabase_key')) localStorage.setItem('lms_supabase_key', supabaseKey);
    if (studentEmail && !localStorage.getItem('lms_student_email')) localStorage.setItem('lms_student_email', studentEmail);
    if (accessToken && !localStorage.getItem('lms_access_token')) localStorage.setItem('lms_access_token', accessToken);
  } catch {}

  return { supabaseUrl, supabaseKey, studentEmail, accessToken };
}

function getHeaders(customKey, customToken) {
  const creds = getSupabaseCredentials();
  const key = customKey || creds.supabaseKey || '';
  const token = customToken || creds.accessToken || '';
  const headers = { apikey: key };
  if (token && token.split('.').length === 3) {
    headers.Authorization = `Bearer ${token}`;
  } else if (key) {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

function pageIdOf(page) {
  return String(page?.id || page?.pageId || '').trim();
}

function isCompletedRow(row) {
  if (!row) return false;
  if (
    row.is_completed === true ||
    String(row.is_completed).toLowerCase() === 'true' ||
    row.is_completed === 1
  ) {
    return true;
  }
  const status = String(row?.status || '').toLowerCase().trim();
  return (
    status === 'completed' ||
    status === 'correct' ||
    status === 'passed' ||
    status === 'missing_answer_key' ||
    status === 'source_saved' ||
    status === 'done'
  );
}

function displayLessonTitle(lesson) {
  const id = String(lesson?.id || lesson?.lessonId || '').trim();
  if (/aftergrad|graduation/i.test(id)) return 'Graduation Project';
  if (customNames?.lessons?.[id]) {
    return customNames.lessons[id];
  }
  const title = String(lesson?.title || '').trim();
  const num = lesson?.globalNumber || lesson?.number || lesson?.lessonNo || 1;
  if (!title || title === id || /^GD_M\d+L\d+$/i.test(title)) {
    return `Lesson ${num}`;
  }
  return title;
}

function moduleDisplayTitle(moduleNo) {
  if (moduleNo === 99) return 'Graduation';
  const key1 = `GD_M${moduleNo}`;
  const key2 = `M${moduleNo}`;
  const key3 = String(moduleNo);
  return (
    customNames?.modules?.[key1] ||
    customNames?.modules?.[key2] ||
    customNames?.modules?.[key3] ||
    `Module ${moduleNo}`
  );
}

export default function StudentHomeDashboard({
  initialCourseId = 'GD',
  courseId: courseIdProp,
  initialLessonId = '',
  studentEmail: studentEmailProp,
  supabaseUrl: supabaseUrlProp,
  supabaseKey: supabaseKeyProp,
  onOpenPage,
}) {
  const normalizedCourseId = String(courseIdProp || initialCourseId || 'GD').trim().toUpperCase();
  const [course, setCourse] = useState(null);
  const [pagesByLesson, setPagesByLesson] = useState({});
  const [highestUnlocked, setHighestUnlocked] = useState(2);
  const [selectedModuleIndex, setSelectedModuleIndex] = useState(0);
  const [selectedLessonIndex, setSelectedLessonIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [profileName, setProfileName] = useState('');
  const [userGender, setUserGender] = useState('male');
  const [dbProgress, setDbProgress] = useState([]);
  const [myCoursesOpen, setMyCoursesOpen] = useState(true);
  const [toasts, setToasts] = useState([]);
  // Increments whenever localStorage changes (from storage events or Supabase sync)
  // so that isPageCompleted re-evaluates after data becomes available
  const [localStorageVersion, setLocalStorageVersion] = useState(0);

  const creds = useMemo(
    () =>
      getSupabaseCredentials({
        studentEmail: studentEmailProp,
        supabaseUrl: supabaseUrlProp,
        supabaseKey: supabaseKeyProp,
      }),
    [studentEmailProp, supabaseUrlProp, supabaseKeyProp]
  );

  const studentEmail = creds.studentEmail;
  const supabaseUrl = creds.supabaseUrl;
  const supabaseKey = creds.supabaseKey;

  const normalizedEmail = useMemo(() => {
    return String(studentEmail || '').trim().toLowerCase();
  }, [studentEmail]);

  // Merge backend dbProgress with frontend localStorage completions (v2: strictly scoped to current user)
  const mergedProgress = useMemo(() => {
    void localStorageVersion;
    const records = [...(dbProgress || [])];
    if (!normalizedEmail) return records;
    // CHỈ ĐỌC key v2 của chính tài khoản đang đăng nhập
    const userPrefix = `lms-completed-tasks:v2:${normalizedEmail}:`;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(userPrefix)) continue;
        const parts = key.replace(userPrefix, '').split(':');
        if (parts.length >= 3) {
          const course_id = parts[0];
          const lesson_id = parts[1];
          const page_id = parts[2];
          const raw = localStorage.getItem(key);
          if (raw) {
            const taskIds = JSON.parse(raw);
            if (Array.isArray(taskIds)) {
              taskIds.forEach((task_id) => {
                records.push({
                  course_id,
                  lesson_id,
                  page_id,
                  task_id,
                  status: 'completed',
                  is_completed: true,
                });
              });
            }
          }
        }
      }
    } catch (e) {
      console.warn('Failed to merge local progress', e);
    }
    return records;
  }, [dbProgress, localStorageVersion, normalizedEmail]);

  const fallbackName = studentEmail
    ? studentEmail
        .split('@')[0]
        .split(/[._-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    : 'Student';
  const displayName = profileName || fallbackName;

  const triggerToast = (message) => {
    const id = Date.now();
    setToasts((previous) => [...previous, { id, message }]);
    window.setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== id));
    }, 3000);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`/courses/${encodeURIComponent(normalizedCourseId)}/index.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`Cannot load ${normalizedCourseId}`);
        return response.json();
      })
      .then(async (data) => {
        const lessons = Array.isArray(data.lessons) ? [...data.lessons] : [];
        lessons.sort((a, b) => {
          const aa = getLessonMeta(a.id || a.lessonId);
          const bb = getLessonMeta(b.id || b.lessonId);
          return aa.moduleNo - bb.moduleNo || aa.lessonNo - bb.lessonNo;
        });

        if (cancelled) return;
        setCourse({ ...data, lessons });

        // Phase 1: Eagerly load raw lesson index.json so pages render immediately
        const lessonEntries = await Promise.all(
          lessons.map(async (lesson) => {
            const id = lesson.id || lesson.lessonId;
            try {
              const response = await fetch(
                `/courses/${encodeURIComponent(normalizedCourseId)}/${encodeURIComponent(id)}/index.json`
              );
              const detail = response.ok ? await response.json() : {};
              const rawPages = Array.isArray(detail.pages) ? detail.pages : [];
              return [id, rawPages];
            } catch {
              return [id, []];
            }
          })
        );

        if (!cancelled) {
          setPagesByLesson(Object.fromEntries(lessonEntries));
          setLoading(false);
        }

        // Phase 2: Compute active task counts and attach taskIds from manifests
        const results = await Promise.all(
          lessonEntries.map(async ([id, rawPages]) => {
            const updatedPages = await Promise.all(
              rawPages.map(async (page) => {
                if (!page.manifest) return page;
                try {
                  const manifestRes = await fetch(page.manifest);
                  if (!manifestRes.ok) return page;
                  const manifestJson = await manifestRes.json();
                  let activityMapJson = null;
                  if (page.manualActivityMap) {
                    try {
                      const mapUrl = resolveActivityMapUrl(page.manualActivityMap);
                      const mapRes = await fetch(mapUrl);
                      if (mapRes.ok) activityMapJson = await mapRes.json();
                    } catch {}
                  }
                  const activeCount = calculateActiveTaskCount(manifestJson, activityMapJson);
                  const taskIds = Array.isArray(manifestJson.tasks)
                    ? manifestJson.tasks.map((t) => t.taskId || t.id).filter(Boolean)
                    : [];
                  return { ...page, taskCount: activeCount, taskIds };
                } catch {
                  return page;
                }
              })
            );

            return [id, updatedPages];
          })
        );

        if (!cancelled) setPagesByLesson(Object.fromEntries(results));
      })
      .catch((error) => console.error('GD dashboard course load failed:', error))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [normalizedCourseId]);

  // Listen for localStorage changes from other tabs or from page sessions writing
  // completed task data. This ensures the dashboard re-renders after a page
  // session writes completion data, showing the page as DONE without needing
  // a full page reload.
  useEffect(() => {
    function handleStorage(event) {
      const key = event.key || '';
      if (
        key.startsWith('lms-completed-tasks:v2:') ||
        (normalizedEmail && key.startsWith(`lms-completed-tasks:v2:${normalizedEmail}:`))
      ) {
        setLocalStorageVersion((v) => v + 1);
      }
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [normalizedEmail]);

  useEffect(() => {
    if (!supabaseUrl || !supabaseKey || !studentEmail) return;

    const headers = getHeaders(supabaseKey, creds.accessToken);

    fetch(
      `${supabaseUrl}/rest/v1/student_lesson_schedules?student_email=ilike.${encodeURIComponent(studentEmail)}&lms_course_id=eq.${encodeURIComponent(LMS_SCHEDULE_COURSE_CODE)}&select=topic_id`,
      { headers }
    )
      .then((response) => (response.ok ? response.json() : []))
      .then((rows) => {
        let max = 2;
        (Array.isArray(rows) ? rows : []).forEach((row) => {
          const value = Number(row.topic_id);
          if (Number.isInteger(value)) max = Math.max(max, value);
        });
        setHighestUnlocked(max);
      })
      .catch(() => setHighestUnlocked(2));

    fetch(
      `${supabaseUrl}/rest/v1/user_profiles?email=ilike.${encodeURIComponent(studentEmail)}&select=name,gender`,
      { headers }
    )
      .then((response) => (response.ok ? response.json() : []))
      .then((rows) => {
        const profile = Array.isArray(rows) ? rows[0] : null;
        const name = String(profile?.name || '').trim();
        if (name) setProfileName(name);

        const gender = String(profile?.gender || '').trim().toLowerCase();
        if (gender === 'female' || gender === 'nữ') setUserGender('female');
        if (gender === 'male' || gender === 'nam') setUserGender('male');
      })
      .catch(() => {});

    async function loadActivityProgress() {
      let rows = [];
      try {
        let res = await fetch(
          `${supabaseUrl}/rest/v1/activity_progress?or=(user_id.ilike.${encodeURIComponent(studentEmail)},session_id.ilike.user:${encodeURIComponent(studentEmail)})&select=course_id,lesson_id,page_id,task_id,status,is_completed`,
          { headers }
        ).catch(() => null);

        if (!res || !res.ok) {
          res = await fetch(
            `${supabaseUrl}/rest/v1/activity_progress?user_id=eq.${encodeURIComponent(studentEmail)}&select=course_id,lesson_id,page_id,task_id,status,is_completed`,
            { headers }
          ).catch(() => null);
        }

        if (res && res.ok) {
          rows = await res.json();
        }
      } catch (err) {
        console.warn('Dashboard activity_progress load failed:', err);
      }

      const validRows = Array.isArray(rows) ? rows : [];
      setDbProgress(validRows);

      // Bước 2.3: Chỉ ghi duy nhất vào key v2 của tài khoản hiện tại, không ghi đè vào các key dùng chung
      if (normalizedEmail) {
        validRows.forEach((row) => {
          if (isCompletedRow(row)) {
            const cId = String(row.course_id || normalizedCourseId || 'GD').trim();
            const lId = String(row.lesson_id || '').trim();
            const pId = String(row.page_id || '').trim();
            const tId = String(row.task_id || '').trim();
            if (pId && tId && cId && lId) {
              const userLmsKey = `lms-completed-tasks:v2:${normalizedEmail}:${cId}:${lId}:${pId}`;
              try {
                const existing = JSON.parse(localStorage.getItem(userLmsKey) || '[]');
                const existingSet = new Set(Array.isArray(existing) ? existing : []);
                if (!existingSet.has(tId)) {
                  existingSet.add(tId);
                  localStorage.setItem(userLmsKey, JSON.stringify(Array.from(existingSet)));
                }
              } catch (e) {}
            }
          }
        });
      }
      // Bump localStorageVersion so isPageCompleted re-evaluates after sync
      setLocalStorageVersion((v) => v + 1);
    }

    loadActivityProgress();
  }, [studentEmail, normalizedEmail, supabaseUrl, supabaseKey, normalizedCourseId, creds]);

  const lessonSequence = useMemo(() => {
    const lessons = course?.lessons || [];
    return lessons.map((lesson, index) => ({
      ...lesson,
      globalNumber: index + 1,
      ...getLessonMeta(lesson.id || lesson.lessonId),
    }));
  }, [course]);

  const lessonsData = useMemo(() => {
    const grouped = new Map();

    lessonSequence.forEach((lesson) => {
      if (!grouped.has(lesson.moduleNo)) grouped.set(lesson.moduleNo, []);
      grouped.get(lesson.moduleNo).push(lesson);
    });

    return Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([moduleNo, moduleLessons], moduleIndex) => {
        const lessons = moduleLessons.map((lesson) => {
          const id = lesson.id || lesson.lessonId;
          const isLocked = lesson.globalNumber > highestUnlocked;
          const pages = (pagesByLesson[id] || []).map((page) => ({
            ...page,
            isLocked,
            locked: isLocked,
          }));

          return {
            ...lesson,
            id,
            key: id,
            moduleId: moduleNo === 99 ? 'GD_Graduation' : `GD_M${moduleNo}`,
            number: lesson.globalNumber,
            title: displayLessonTitle(lesson),
            pages,
            isLocked,
            locked: isLocked,
            isUnlocked: !isLocked,
          };
        });

        const pageCount = lessons.reduce((sum, lesson) => sum + lesson.pages.length, 0);
        const taskCount = lessons.reduce(
          (sum, lesson) =>
            sum + lesson.pages.reduce((pageSum, page) => pageSum + Number(page.taskCount || 0), 0),
          0
        );
        const isLocked = lessons.length ? lessons[0].isLocked : true;

        return {
          id: moduleNo === 99 ? 'GD_Graduation' : `GD_M${moduleNo}`,
          moduleNo,
          number: moduleIndex + 1,
          title: moduleDisplayTitle(moduleNo),
          displayLabel: moduleNo === 99 ? 'Graduation' : `Module ${moduleIndex + 1}`,
          lessons,
          isLocked,
          isUnlocked: !isLocked,
          pageCount,
          taskCount,
        };
      });
  }, [lessonSequence, pagesByLesson, highestUnlocked]);

  useEffect(() => {
    if (!lessonsData.length) return;

    try {
      sessionStorage.setItem('lms-global-lessons-data', JSON.stringify(lessonsData));
    } catch {}

    let targetModIdx = -1;
    let targetLesIdx = -1;

    try {
      const params = new URLSearchParams(window.location.search);
      const rawTargetLessonId = params.get('lesson') || initialLessonId;
      const targetLessonId = typeof rawTargetLessonId === 'string' ? rawTargetLessonId.trim() : '';

      if (targetLessonId) {
        const norm = (s) => String(s || '').trim().toLowerCase().replace(/^gd[_-]/, '');
        const targetNorm = norm(targetLessonId);

        lessonsData.forEach((mod, mIdx) => {
          mod.lessons.forEach((les, lIdx) => {
            const id = String(les.id || les.lessonId || '').trim();
            if (id === targetLessonId || (targetNorm && norm(id) === targetNorm)) {
              targetModIdx = mIdx;
              targetLesIdx = lIdx;
            }
          });
        });
      }
    } catch {}

    if (targetModIdx >= 0 && targetLesIdx >= 0) {
      setSelectedModuleIndex(targetModIdx);
      setSelectedLessonIndex(targetLesIdx);
      return;
    }

    // Always default to Module 1 (index 0) and Lesson 1 (index 0) when logging in / opening the dashboard freshly
    setSelectedModuleIndex(0);
    setSelectedLessonIndex(0);
  }, [lessonsData, initialLessonId]);

  const activeModule = lessonsData[selectedModuleIndex] || lessonsData[0] || null;
  const activeLesson = activeModule?.lessons?.[selectedLessonIndex] || activeModule?.lessons?.[0] || null;

  const activeModuleProgress = useMemo(() => {
    if (!activeModule) return { percentage: 0, correctCount: 0, totalCount: 0 };
    void localStorageVersion;

    const pageIdsLower = new Set(
      activeModule.lessons.flatMap((lesson) => lesson.pages.map((page) => pageIdOf(page).toLowerCase())).filter(Boolean)
    );
    const totalCount = activeModule.lessons.reduce(
      (sum, lesson) =>
        sum + lesson.pages.reduce((pageSum, page) => pageSum + Number(page.taskCount || 0), 0),
      0
    );
    const completedTasks = new Set();

    mergedProgress.forEach((row) => {
      const pageId = String(row.page_id || '').trim().toLowerCase();
      const taskId = String(row.task_id || '').trim();
      if (isCompletedRow(row) && pageId && taskId && pageIdsLower.has(pageId)) {
        completedTasks.add(`${pageId}|${taskId}`);
      }
    });

    return {
      percentage: totalCount
        ? Math.min(100, Math.round((completedTasks.size / totalCount) * 100))
        : 0,
      correctCount: completedTasks.size,
      totalCount,
    };
  }, [activeModule, mergedProgress, localStorageVersion]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const isPageCompleted = (page) => {
    // localStorageVersion is read here to ensure this function re-evaluates
    // whenever localStorage is updated (Supabase sync, page session writes, etc.)
    void localStorageVersion;

    const pageId = pageIdOf(page);
    if (!pageId) return false;
    const pageIdLower = pageId.toLowerCase();
    const total = Number(page.taskCount || 0);

    const completed = new Set();

    // 1. Check mergedProgress (Supabase DB + current user's local v2 completions)
    mergedProgress.forEach((row) => {
      if (isCompletedRow(row)) {
        const rowPageId = String(row.page_id || '').trim().toLowerCase();
        const rowTaskId = String(row.task_id || '').trim();
        if (rowPageId === pageIdLower && rowTaskId) {
          completed.add(rowTaskId);
        }
      }
    });

    // 2. Direct check on current user's localStorage v2 keys if any
    if (normalizedEmail) {
      try {
        const userPrefix = `lms-completed-tasks:v2:${normalizedEmail}:`;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key || !key.startsWith(userPrefix)) continue;
          const keyLower = key.toLowerCase();
          if (keyLower.endsWith(`:${pageIdLower}`)) {
            try {
              const ids = JSON.parse(localStorage.getItem(key) || '[]');
              if (Array.isArray(ids)) ids.forEach((tid) => completed.add(tid));
            } catch {}
          }
        }
      } catch {}
    }

    // 3. If page has specific taskIds attached from manifest
    if (Array.isArray(page.taskIds) && page.taskIds.length > 0) {
      return page.taskIds.every((tid) => completed.has(tid));
    }

    return total > 0 ? completed.size >= total : completed.size > 0;
  };

  const handleLaunchPage = (lesson, page) => {
    if (!lesson || lesson.isLocked === true || page?.isLocked === true) {
      triggerToast('This lesson is locked until it is scheduled.');
      return;
    }
    const lessonId = lesson.id || lesson.lessonId;
    const pageId = pageIdOf(page);
    if (lessonId && pageId) onOpenPage?.(lessonId, pageId);
  };

  const handleLaunchFirstPageOfLesson = (lesson) => {
    if (!lesson || lesson.isLocked === true) {
      triggerToast('This lesson is locked until it is scheduled.');
      return;
    }
    const firstPage = lesson.pages?.[0];
    if (firstPage) handleLaunchPage(lesson, firstPage);
    else triggerToast('No pages available for this lesson.');
  };

  const handleLogout = () => {
    localStorage.clear();
    const hostname = window.location.hostname;
    const platformOrigin =
      hostname === 'localhost' || hostname === '127.0.0.1'
        ? 'http://localhost:5174'
        : 'https://learn.algo.edu.vn';
    const targetUrl = `${platformOrigin}/auth/sign-out`;

    try {
      if (window.self !== window.top) window.top.location.href = targetUrl;
      else window.location.href = targetUrl;
    } catch {
      window.location.href = targetUrl;
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'Nunito, sans-serif', color: '#4f46e5' }}>
        Getting your learning space ready...
      </div>
    );
  }

  const bannerAsset = `/assets/banner-${userGender}.png`;

  return (
    <div className="dashboard-layout">
      <aside className="dashboard-sidebar">
        <div className="sidebar-logo">
          <img src={LOGO_ASSET} alt="Algo Learning Space" className="sidebar-logo-image" />
          <div className="sidebar-brand-copy">
            <span className="sidebar-logo-name">Algo</span>
            <span className="sidebar-logo-subtitle">Learning Space</span>
          </div>
        </div>

        <nav className="sidebar-menu">
          <div className="menu-item-container">
            <button
              type="button"
              className="menu-item active"
              onClick={() => setMyCoursesOpen((previous) => !previous)}
            >
              <svg className="menu-item-icon" viewBox="0 0 24 24">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              <span>My Courses</span>
              <svg
                className={`menu-chevron ${myCoursesOpen ? 'open' : ''}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <div className={`submenu ${myCoursesOpen ? 'open' : ''}`}>
              <button type="button" className="submenu-item active">
                {normalizedCourseId}
              </button>
            </div>
          </div>

          <button type="button" className="menu-item" onClick={() => triggerToast('Coming soon: Achievements')}>
            <svg className="menu-item-icon" viewBox="0 0 24 24">
              <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
              <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
              <path d="M4 22h16" />
              <path d="M10 14.66V17c0 .55-.45 1-1 1H4v2h16v-2h-5c-.55 0-1-.45-1-1v-2.34" />
              <path d="M12 2a6 6 0 0 1 6 6v3.5a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8a6 6 0 0 1 6-6z" />
            </svg>
            <span>Achievements</span>
          </button>

          <button type="button" className="menu-item" onClick={() => triggerToast('Coming soon: Calendar')}>
            <svg className="menu-item-icon" viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>Calendar</span>
          </button>

          <button type="button" className="menu-item" onClick={() => triggerToast('Coming soon: Messages')}>
            <svg className="menu-item-icon" viewBox="0 0 24 24">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>Messages</span>
          </button>

          <button type="button" className="menu-item" onClick={() => triggerToast('Coming soon: Resources')}>
            <svg className="menu-item-icon" viewBox="0 0 24 24">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span>Resources</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <button type="button" className="menu-item" onClick={() => triggerToast('Coming soon: Settings')}>
            <svg className="menu-item-icon" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09A1.65 1.65 0 0 0 20.91 10H21a2 2 0 0 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15z" />
            </svg>
            <span>Settings</span>
          </button>

          <button type="button" className="menu-item" onClick={handleLogout}>
            <svg className="menu-item-icon" viewBox="0 0 24 24">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Log out</span>
          </button>

          <div className="sidebar-profile">
            <div className="profile-avatar">👤</div>
            <div className="profile-info">
              <div className="profile-name">{displayName}</div>
              <div className="profile-role">Student</div>
            </div>
          </div>
        </div>
      </aside>

      <main className="dashboard-center">
        {/* Header Greeting */}
        <header className="center-header">
          <div>
            <h1 className="greeting-title">Ready for your next challenge, {displayName || 'Student'}! 👋</h1>
            <p className="greeting-subtitle">Let's continue your learning journey today.</p>
          </div>
          <div className="header-actions"></div>
        </header>

        <section
          className="learning-banner dynamic-banner"
          style={{ backgroundImage: `url('/assets/banner-${userGender}.png')` }}
        >
          <div className="banner-content">
            <h2 className="banner-title">
              {activeModule
                ? `${activeModule.displayLabel}: ${activeModule.title}`
                : 'Loading your course...'}
            </h2>
            <p className="banner-subtitle">
              {COURSE_TITLE}
            </p>
          </div>
        </section>

        {activeModule && (
          <section className="module-progress-section">
            <div className="module-progress-details">
              <span className="progress-card-label">Module Progress</span>
              <h3 className="progress-module-title">
                {activeModule.displayLabel}: {activeModule.title}
              </h3>
              <p className="progress-module-stats">
                {activeModule.pageCount} pages &bull; {activeModuleProgress.correctCount} / {activeModuleProgress.totalCount} tasks
              </p>

              <div
                className={`progress-status-pill ${
                  activeModule.isLocked
                    ? 'locked'
                    : activeModuleProgress.percentage === 100
                      ? 'completed'
                      : 'in-progress'
                }`}
              >
                <span className="status-pill-icon">
                  {activeModule.isLocked
                    ? '🔒'
                    : activeModuleProgress.percentage === 100
                      ? '🏆'
                      : '📖'}
                </span>
                <span className="status-pill-text">
                  {activeModule.isLocked
                    ? 'Locked until the first lesson in this module is scheduled.'
                    : activeModuleProgress.percentage === 100
                      ? 'Module completed. Great job!'
                      : 'In progress. Keep going!'}
                </span>
              </div>
            </div>

            <div className="module-progress-wheel">
              <svg className="progress-ring" width="100" height="100">
                <circle
                  className="progress-ring__background"
                  stroke="#e2e8f0"
                  strokeWidth="8"
                  fill="transparent"
                  r="38"
                  cx="50"
                  cy="50"
                />
                <circle
                  className="progress-ring__circle"
                  stroke="#6366f1"
                  strokeWidth="8"
                  fill="transparent"
                  r="38"
                  cx="50"
                  cy="50"
                  style={{
                    strokeDasharray: `${2 * Math.PI * 38}`,
                    strokeDashoffset: `${2 * Math.PI * 38 * (1 - activeModuleProgress.percentage / 100)}`,
                  }}
                />
              </svg>
              <div className="wheel-content">
                <span className="wheel-percentage">{activeModuleProgress.percentage}%</span>
                <span className="wheel-label">Completed</span>
              </div>
            </div>
          </section>
        )}

        <section className="journey-section">
          <div className="section-header">
            <h3 className="section-title">Course Modules Progress</h3>
          </div>

          <div className="timeline-wrapper">
            <div className="timeline-line">
              {lessonsData.length ? (
                lessonsData.map((module, index) => {
                  const isCurrent = index === selectedModuleIndex;
                  const isLocked = module.isLocked === true;
                  const statusClass = isLocked ? 'locked' : isCurrent ? 'active' : 'completed';
                  const statusLabel = isLocked ? '🔒' : `${module.number}`;

                  return (
                    <div key={module.id} className="timeline-step">
                      <button
                        type="button"
                        disabled={isLocked}
                        aria-disabled={isLocked}
                        className={`step-node ${statusClass}`}
                        onClick={() => {
                          if (isLocked) {
                            triggerToast(`${module.displayLabel} is locked until its first lesson is scheduled.`);
                            return;
                          }
                          setSelectedModuleIndex(index);
                          setSelectedLessonIndex(0);
                        }}
                      >
                        {statusLabel}
                      </button>
                      <span className={`step-name ${isCurrent ? 'active' : ''}`}>
                        {module.displayLabel}
                      </span>
                    </div>
                  );
                })
              ) : (
                <p className="dashboard-loading-text">No course modules are available.</p>
              )}
            </div>
          </div>
        </section>

        <div className="dashboard-grid">
          {activeModule ? (
            <div className="continue-card lesson-selector-card">
              <div className="continue-card-header">
                <span className="card-label">{activeModule.displayLabel}</span>
                <h4 className="card-title">{activeModule.title}</h4>
              </div>

              <div className="lesson-selection-list">
                {activeModule.lessons.map((lesson, index) => {
                  const isSelected = index === selectedLessonIndex;
                  const isLocked = lesson.isLocked === true;

                  return (
                    <button
                      key={lesson.key}
                      type="button"
                      disabled={isLocked}
                      aria-disabled={isLocked}
                      className={[
                        'lesson-list-btn',
                        isSelected ? 'active' : '',
                        isLocked ? 'locked' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={() => {
                        if (!isLocked) setSelectedLessonIndex(index);
                      }}
                    >
                      <div className="lesson-number-badge">
                        L{lesson.number}
                      </div>
                      <div className="lesson-info-text">
                        <div className="lesson-list-title">{lesson.title}</div>
                        <div className="lesson-list-pages-count">
                          {isLocked ? 'Locked' : `${lesson.pages?.length || 0} activities`}
                        </div>
                      </div>
                      <span className="lesson-list-arrow">{isLocked ? '🔒' : '>'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="continue-card dashboard-loading-card">
              <p className="dashboard-loading-text">No lessons are available.</p>
            </div>
          )}

          <div className="my-courses-card">
            <div className="section-header">
              <h3 className="section-title">Lesson Pages</h3>
              <span className="pages-count-tag">{activeLesson?.pages?.length || 0} pages</span>
            </div>

            <div className="pages-circles-grid">
              {activeLesson?.pages?.length ? (
                activeLesson.pages.map((page, index) => {
                  const pageNum = index + 1;
                  const tasksCount = Number(page.taskCount || 0);
                  const isLocked = activeLesson.isLocked === true || page.isLocked === true;
                  const isCompleted = !isLocked && isPageCompleted(page);

                  return (
                    <button
                      key={pageIdOf(page) || index}
                      type="button"
                      disabled={isLocked}
                      aria-disabled={isLocked}
                      className={[
                        'page-circle-item',
                        isLocked ? 'locked' : '',
                        isCompleted ? 'completed' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={() => {
                        if (!isLocked) handleLaunchPage(activeLesson, page);
                      }}
                    >
                      <div className="circle-node">
                        <span className="circle-label">
                          {isLocked ? 'LOCKED' : isCompleted ? 'DONE' : 'PAGE'}
                        </span>
                        <span className="circle-number">
                          {isLocked ? '🔒' : isCompleted ? '✓' : String(pageNum).padStart(2, '0')}
                        </span>
                      </div>
                      <span className="circle-task-count">
                        {isLocked ? 'Locked' : `${tasksCount} ${tasksCount === 1 ? 'task' : 'tasks'}`}
                      </span>
                    </button>
                  );
                })
              ) : (
                <p className="dashboard-empty-pages">No pages in this lesson.</p>
              )}
            </div>

            <div className="continue-card-footer lesson-pages-footer">
              <button
                type="button"
                disabled={!activeLesson || activeLesson.isLocked === true}
                aria-disabled={!activeLesson || activeLesson.isLocked === true}
                className="card-btn lesson-start-button"
                onClick={() => handleLaunchFirstPageOfLesson(activeLesson)}
              >
                {!activeLesson
                  ? 'Select a lesson'
                  : activeLesson.isLocked
                    ? `Lesson ${activeLesson.number} Locked`
                    : `Start Lesson ${activeLesson.number}`}
              </button>
            </div>
          </div>
        </div>

        <div className="motivational-banner">
          <span className="moti-icon">👾</span>
          <p className="moti-text">
            Keep going, {displayName}! You're doing great! Every lesson brings you closer to becoming a creator.
          </p>
        </div>
      </main>

      <aside className="dashboard-right">
        <div className="right-card right-courses-card">
          <div className="right-card-header right-courses-header">
            <h4 className="right-card-title right-courses-title">My Courses</h4>
            <span className="right-courses-count">1 upcoming</span>
          </div>

          <div className="right-courses-list">
            <button type="button" className="right-course-item right-course-current selected">
              <span className="right-course-icon">
                <img src={GD_BADGE} alt="Game Development badge" />
              </span>
              <span className="right-course-content">
                <span className="right-course-heading">
                  <span className="right-course-name">{COURSE_TITLE}</span>
                  <span className="right-course-status current">Current</span>
                </span>
                <span className="right-course-description">Open this course to continue learning.</span>
              </span>
            </button>

            <div className="right-course-item right-course-upcoming">
              <span className="right-course-icon upcoming">
                <img src={WD_BADGE} alt="Web Development badge" />
              </span>
              <span className="right-course-content">
                <span className="right-course-heading">
                  <span className="right-course-name">{NEXT_COURSE_TITLE}</span>
                  <span className="right-course-status upcoming">Upcoming</span>
                </span>
                <span className="right-course-description">Your next course in the main pathway.</span>
              </span>
            </div>
          </div>
        </div>

        <div className="right-card">
          <div className="coming-soon-overlay"><span className="coming-soon-badge">Coming soon</span></div>
          <div className="right-card-header"><h4 className="right-card-title">Achievements</h4></div>
          <div className="achievements-list">
            <div className="achievement-row"><div className="ach-icon">🏆</div><div className="ach-info"><h5 className="ach-name">Completed Lessons</h5><p className="ach-desc">8 lessons completed</p></div></div>
            <div className="achievement-row"><div className="ach-icon">🔥</div><div className="ach-info"><h5 className="ach-name">Current Streak</h5><p className="ach-desc">3 weeks active</p></div></div>
            <div className="achievement-row"><div className="ach-icon">📈</div><div className="ach-info"><h5 className="ach-name">Quiz Average</h5><p className="ach-desc">92% score rate</p></div></div>
          </div>
        </div>

        <div className="right-card">
          <div className="coming-soon-overlay"><span className="coming-soon-badge">Coming soon</span></div>
          <div className="right-card-header"><h4 className="right-card-title">Upcoming Class</h4></div>
          <div style={{ opacity: 0.5 }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>Saturday, 10:00 AM</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Teacher Kevin Nguyen</div>
            <div style={{ background: '#e0e7ff', color: '#4f46e5', padding: 10, borderRadius: 10, textAlign: 'center', fontWeight: 700, fontSize: 13 }}>
              Join Google Meet
            </div>
          </div>
        </div>

        <div className="right-card">
          <div className="coming-soon-overlay"><span className="coming-soon-badge">Coming soon</span></div>
          <div className="right-card-header"><h4 className="right-card-title">Teacher Feedback</h4></div>
          <div style={{ opacity: 0.5, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#cbd5e1', display: 'grid', placeItems: 'center', fontSize: 16 }}>👨‍🏫</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Kevin Nguyen</div>
              <p style={{ margin: 0, fontSize: 12, color: '#475569', lineHeight: 1.4 }}>
                "Great job using loops this week! Remember to practise nested loops before next lesson."
              </p>
              <span style={{ fontSize: 10, color: '#94a3b8', display: 'block', marginTop: 4 }}>2 days ago</span>
            </div>
          </div>
        </div>
      </aside>

      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast"><span>ℹ️</span><span>{toast.message}</span></div>
        ))}
      </div>
    </div>
  );
}
