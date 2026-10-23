import { useEffect, useState, useMemo, useRef } from 'react';
import TeacherCoursePreview from '../components/TeacherCoursePreview.jsx';
import customNames from '../config/mapping.json';
import { resetPageProgressInSupabase } from '../lib/supabaseProgress.js';
import './TeacherDashboard.css';

const CATALOG_URL = '/courses/index.json';
const DEFAULT_COURSE_ID = 'GD';

export default function TeacherDashboard({
  initialCourseId = DEFAULT_COURSE_ID,
  initialLessonId = '',
  initialSelectedLessonId = '',
  initialSelectedPageId = '',
  initialActiveTab = 'classes',
  onOpenPage,
}) {
  const mapCatalogIdToDbId = (id) => {
    if (id === 'PTSY1') return '863374997183';
    if (id === 'PTPY1') return '870430906310';
    return id;
  };

  const mapDbIdToCatalogId = (id) => {
    if (id === '863374997183') return 'PTSY1';
    if (id === '870430906310') return 'PTPY1';
    return id;
  };

  const sortModulesHelper = (modulesList) => {
    if (!modulesList) return [];
    return [...modulesList].sort((a, b) => {
      const aIsGraduation = /graduation/i.test(`${a?.title || ''} ${a?.id || ''}`);
      const bIsGraduation = /graduation/i.test(`${b?.title || ''} ${b?.id || ''}`);

      if (aIsGraduation !== bIsGraduation) {
        return aIsGraduation ? 1 : -1;
      }

      const moduleNumberA = parseInt(
        String(a?.id || '').match(/M(\d+)/i)?.[1] || '999',
        10
      );
      const moduleNumberB = parseInt(
        String(b?.id || '').match(/M(\d+)/i)?.[1] || '999',
        10
      );

      return moduleNumberA - moduleNumberB;
    });
  };

  const getCourseCodeDisplay = (code) => {
    const raw = String(code || selectedCourseId || DEFAULT_COURSE_ID).trim().toUpperCase();
    return raw || DEFAULT_COURSE_ID;
  };

  const getValidSupabaseToken = (anonKey) => {
    const cachedToken = localStorage.getItem('lms_access_token');
    if (!cachedToken) return anonKey;

    try {
      const parts = cachedToken.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (typeof payload.exp === 'number') {
          const isExpired = payload.exp < (Date.now() / 1000);
          if (isExpired) {
            console.warn('TeacherDashboard: lms_access_token has expired. Falling back to anon key.');
            return anonKey;
          }
        }
      }
    } catch (e) {
      console.warn('TeacherDashboard: Failed to parse access token. Falling back to anon key.', e);
      return anonKey;
    }

    return cachedToken;
  };

  const [catalog, setCatalog] = useState(null);
  const [selectedCourseId, setSelectedCourseId] = useState(
    sessionStorage.getItem('teacher_selected_course_id') || initialCourseId || DEFAULT_COURSE_ID
  );
  const [selectedCourseData, setSelectedCourseData] = useState(null);
  const [selectedModuleId, setSelectedModuleId] = useState('');
  const [selectedModuleData, setSelectedModuleData] = useState(null);
  const [selectedLessonId, setSelectedLessonId] = useState(
    initialSelectedLessonId || initialLessonId || ''
  );

  const [myClassesOpen, setMyClassesOpen] = useState(true);

  // Preview Mode State
  const [selectedPreviewCourseId, setSelectedPreviewCourseId] = useState(
    sessionStorage.getItem('teacher_selected_preview_course_id') || (initialActiveTab === 'preview' ? initialCourseId : '')
  );

  // DB Data
  const [students, setStudents] = useState([]);
  const [dbAttempts, setDbAttempts] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [resolvedCourseId, setResolvedCourseId] = useState('');
  const [courseModulesData, setCourseModulesData] = useState([]);
  const [profileTeacherName, setProfileTeacherName] = useState('');

  // Tab navigation states
  const [activeTab, setActiveTab] = useState(
    sessionStorage.getItem('teacher_active_tab') || initialActiveTab || 'classes'
  );
  const [studentSearchQuery, setStudentSearchQuery] = useState('');

  // My Classes view controls
  const [classProgressFilter, setClassProgressFilter] = useState('all');
  const [classSortMode, setClassSortMode] = useState('progress-asc');
  const [selectedPageId, setSelectedPageId] = useState(
    initialSelectedPageId || sessionStorage.getItem('teacher_selected_page_id') || 'overview'
  );

  // Toast notifier
  const [toasts, setToasts] = useState([]);
  const triggerToast = (message = 'Coming soon') => {
    const id = Date.now();
    setToasts([{ id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3000);
  };

  useEffect(() => {
    sessionStorage.setItem('teacher_selected_course_id', selectedCourseId || '');
  }, [selectedCourseId]);

  useEffect(() => {
    // Clear any stale cached module/lesson when entering
    sessionStorage.removeItem('teacher_selected_module_id');
    sessionStorage.removeItem('teacher_selected_lesson_id');
  }, [selectedCourseId]);

  useEffect(() => {
    sessionStorage.setItem('teacher_selected_page_id', selectedPageId || 'overview');
  }, [selectedPageId]);

  useEffect(() => {
    sessionStorage.setItem('teacher_active_tab', activeTab || 'classes');
  }, [activeTab]);

  useEffect(() => {
    sessionStorage.setItem('teacher_selected_preview_course_id', selectedPreviewCourseId || '');
  }, [selectedPreviewCourseId]);

  const supabaseUrl = localStorage.getItem('lms_supabase_url');
  const supabaseKey = localStorage.getItem('lms_supabase_key');
  const currentTeacherEmail =
    localStorage.getItem('lms_user_email') ||
    localStorage.getItem('lms_student_email') ||
    '';
  const teacherDisplayName = currentTeacherEmail
    ? currentTeacherEmail
        .split('@')[0]
        .split(/[._-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    : 'Teacher';
  const isDbMode = !!(supabaseUrl && supabaseKey);

  const handleLogout = () => {
    localStorage.clear();
    let platformOrigin = '';
    if (document.referrer) {
      try {
        const refUrl = new URL(document.referrer);
        if (refUrl.origin) platformOrigin = refUrl.origin;
      } catch (e) {
        // ignore
      }
    }
    if (!platformOrigin || platformOrigin.includes(window.location.hostname)) {
      const hostname = window.location.hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        platformOrigin = 'http://localhost:5174';
      } else {
        platformOrigin = 'https://learn.algo.edu.vn';
      }
    }
    const targetUrl = `${platformOrigin}/auth/sign-out`;
    try {
      if (window.self !== window.top) {
        window.top.location.href = targetUrl;
      } else {
        window.location.href = targetUrl;
      }
    } catch (e) {
      window.location.href = targetUrl;
    }
  };

  // Load Course Catalog List
  useEffect(() => {
    fetch(CATALOG_URL)
      .then((res) => res.json())
      .then((data) => {
        setCatalog(data);
        if (data.courses && data.courses.length > 0) {
          const matchedCourse = initialCourseId
            ? data.courses.find((c) => c.id === initialCourseId)
            : null;
          const targetCourse = matchedCourse || data.courses[0];
          setSelectedCourseId(targetCourse.id);
          if (initialActiveTab === 'preview') {
            setSelectedPreviewCourseId(targetCourse.id);
          }
        }
      })
      .catch((err) => console.error('Failed to load courses list:', err));
  }, [initialCourseId, initialActiveTab]);

  // Load Course Index
  useEffect(() => {
    if (!catalog || !catalog.courses || catalog.courses.length === 0) return;
    const courseInfo =
      catalog.courses.find((c) => c.id === selectedCourseId) ||
      catalog.courses[0];
    if (!courseInfo) return;
    const courseIndexUrl = courseInfo.index || `/courses/${selectedCourseId}/index.json`;

    fetch(courseIndexUrl)
      .then((res) => res.json())
      .then((data) => {
        setSelectedCourseData(data);
      })
      .catch((err) => console.error('Failed to load course details:', err));
  }, [selectedCourseId, catalog]);

  // Query DB Students & Attempts for the selected course dynamically
  useEffect(() => {
    if (!isDbMode || !selectedCourseId) {
      setStudents([]);
      setDbAttempts([]);
      return;
    }

    const dbCourseId = mapCatalogIdToDbId(selectedCourseId);
    const supabaseToken = getValidSupabaseToken(supabaseKey);

    const fetchStudentsAndProgress = (realCourseId) => {
      setResolvedCourseId(realCourseId);
      const membersUrl = `${supabaseUrl}/rest/v1/classroom_course_members?course_id=eq.${realCourseId}&role=eq.student&select=google_user_id,name,email`;
      fetch(membersUrl, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseToken}`
        }
      })
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          if (Array.isArray(data) && data.length > 0) {
            const emails = data.map((m) => m.email).filter(Boolean);
            const usernames = emails.map((e) => e.split('@')[0]);

            const fetchProfiles = () => {
              if (usernames.length === 0) return Promise.resolve([]);
              const profilesUrl = `${supabaseUrl}/rest/v1/user_profiles?username=in.(${usernames.map(u => `"${u}"`).join(',')})&select=*`;
              return fetch(profilesUrl, {
                headers: {
                  'apikey': supabaseKey,
                  'Authorization': `Bearer ${supabaseToken}`
                }
              })
                .then(res => res.ok ? res.json() : [])
                .catch(() => []);
            };

            fetchProfiles().then((profiles) => {
              const studentsList = data.map((m) => {
                const emailLower = m.email?.toLowerCase();
                const usernamePart = m.email?.split('@')[0]?.toLowerCase();
                const profile = profiles.find(p => 
                  p.email?.toLowerCase() === emailLower || 
                  p.username?.toLowerCase() === usernamePart
                );

                const dbName = profile?.name || m.name || m.email.split('@')[0];
                const dbCode = profile ? (profile['student code'] || profile.student_code) : '';
                const displayName = dbCode ? `${dbName} ${dbCode}` : dbName;

                return {
                  id: m.google_user_id || m.email,
                  name: displayName,
                  email: m.email,
                  username: profile?.username || usernamePart,
                  password: profile?.password || ''
                };
              });
              setStudents(studentsList);
            });
          } else {
            setStudents([]);
          }
        })
        .catch((err) => {
          console.error('TeacherDashboard: error loading course members:', err);
          setStudents([]);
        });

      const attemptsUrl = `${supabaseUrl}/rest/v1/activity_progress?or=(course_id.eq.${realCourseId},course_id.eq.${selectedCourseId})&select=user_id,course_id,lesson_id,page_id,task_id,status,is_completed`;
      fetch(attemptsUrl, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseToken}`
        }
      })
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          if (Array.isArray(data)) {
            setDbAttempts(data);
          }
        })
        .catch((err) => {
          console.error('TeacherDashboard: error fetching progress:', err);
          setDbAttempts([]);
        });
    };

    const resolveTeacherCourseId = async () => {
      const teacherEmail = currentTeacherEmail;
      if (!teacherEmail) return null;
      try {
        const teacherClassUrl = `${supabaseUrl}/rest/v1/classroom_course_members?email=eq.${teacherEmail}&role=eq.teacher&select=course_id,course_code,name`;
        const res = await fetch(teacherClassUrl, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseToken}`
          }
        });
        if (!res.ok) return null;
        const memberships = await res.json();
        if (!Array.isArray(memberships) || memberships.length === 0) return null;

        const teacherMember = memberships.find((m) => m.name);
        if (teacherMember && teacherMember.name) {
          setProfileTeacherName(teacherMember.name);
        }

        const savedCourseId = localStorage.getItem('lms_course_id');
        if (savedCourseId) {
          const matchBySavedId = memberships.find(m => String(m.course_id) === String(savedCourseId));
          if (matchBySavedId) return matchBySavedId.course_id;
        }

        const matchByCode = memberships.find(m => 
          m.course_code === selectedCourseId || 
          (m.course_code && selectedCourseId && m.course_code.toUpperCase().includes(selectedCourseId.toUpperCase()))
        );
        if (matchByCode && matchByCode.course_id) return matchByCode.course_id;

        const teacherCourseIds = memberships.map(m => m.course_id).filter(Boolean);
        if (teacherCourseIds.length > 0) {
          const coursesUrl = `${supabaseUrl}/rest/v1/classroom_courses?id=in.(${teacherCourseIds.join(',')})&select=id,code`;
          const coursesRes = await fetch(coursesUrl, {
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseToken}`
            }
          });
          if (coursesRes.ok) {
            const coursesList = await coursesRes.json();
            const matchedCourse = coursesList.find(c => c.code === selectedCourseId || c.id === dbCourseId);
            if (matchedCourse) return matchedCourse.id;
          }
        }
      } catch (err) {
        console.warn('TeacherDashboard: failed to dynamically resolve teacher course ID:', err);
      }
      return null;
    };

    resolveTeacherCourseId().then((resolvedId) => {
      if (resolvedId) {
        fetchStudentsAndProgress(resolvedId);
      } else {
        const coursesUrl = `${supabaseUrl}/rest/v1/classroom_courses?or=(code.eq.${dbCourseId},id.eq.${dbCourseId})&select=id`;
        fetch(coursesUrl, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseToken}`
          }
        })
          .then((res) => (res.ok ? res.json() : []))
          .then((courseData) => {
            const realCourseId = (courseData && courseData[0] && courseData[0].id) || dbCourseId;
            fetchStudentsAndProgress(realCourseId);
          })
          .catch(() => fetchStudentsAndProgress(dbCourseId));
      }
    });

  }, [selectedCourseId, isDbMode, supabaseUrl, supabaseKey, currentTeacherEmail]);

  // Group raw lesson items in course index into Modules
  const groupedModules = useMemo(() => {
    const rawLessons = selectedCourseData?.lessons || [];
    if (!rawLessons.length) return [];

    const map = new Map();
    rawLessons.forEach((item) => {
      const rawId = String(item.id || item.lessonId || '');
      const isGrad = /aftergrad|graduation/i.test(rawId);
      const modMatch = rawId.match(/_M(\d+)/i) || rawId.match(/M(\d+)/i);
      const modNum = isGrad ? 99 : modMatch ? parseInt(modMatch[1], 10) : 1;
      const modKey = isGrad ? `${selectedCourseId}_Graduation` : `${selectedCourseId}_M${modNum}`;

      if (!map.has(modKey)) {
        const mappedTitle = customNames?.modules?.[modKey] || (isGrad ? 'Graduation' : `Module ${modNum}`);
        map.set(modKey, {
          id: modKey,
          modNum,
          code: isGrad ? 'GR' : `M${modNum}`,
          title: mappedTitle,
          isGraduation: isGrad,
          rawLessons: []
        });
      }
      map.get(modKey).rawLessons.push(item);
    });

    return Array.from(map.values()).sort((a, b) => a.modNum - b.modNum);
  }, [selectedCourseData, selectedCourseId]);

  const initialLessonSyncRef = useRef(false);

  useEffect(() => {
    initialLessonSyncRef.current = false;
  }, [selectedCourseId]);

  // Sync selectedModuleId and selectedLessonId on initial load
  useEffect(() => {
    if (!groupedModules.length) return;

    if (!initialLessonSyncRef.current) {
      initialLessonSyncRef.current = true;

      let targetLesson = initialSelectedLessonId || initialLessonId || '';
      try {
        const p = new URLSearchParams(window.location.search);
        targetLesson = p.get('lesson') || targetLesson;
      } catch {}

      if (targetLesson && typeof targetLesson === 'string' && targetLesson.trim()) {
        const targetTrimmed = targetLesson.trim();
        const norm = (s) => String(s || '').trim().toLowerCase().replace(/^gd[_-]/, '');
        const targetNorm = norm(targetTrimmed);

        const parentMod = groupedModules.find((m) =>
          m.rawLessons && m.rawLessons.some((l) => {
            const lId = String(l.id || l.lessonId || '').trim();
            return lId === targetTrimmed || (targetNorm && norm(lId) === targetNorm);
          })
        );
        if (parentMod) {
          setSelectedModuleId(parentMod.id);
          const matchingLesson = parentMod.rawLessons.find((l) => {
            const lId = String(l.id || l.lessonId || '').trim();
            return lId === targetTrimmed || (targetNorm && norm(lId) === targetNorm);
          });
          if (matchingLesson) {
            setSelectedLessonId(matchingLesson.id || matchingLesson.lessonId);
          } else {
            setSelectedLessonId(targetTrimmed);
          }
          return;
        }
      }

      // Always default to the FIRST module (Module 1) when entering the course cleanly
      setSelectedModuleId(groupedModules[0].id);
      const firstLesson = groupedModules[0].rawLessons?.[0];
      if (firstLesson) {
        setSelectedLessonId(firstLesson.id || firstLesson.lessonId);
      }
      return;
    }

    const exists = groupedModules.some((m) => m.id === selectedModuleId);
    if (!selectedModuleId || !exists) {
      setSelectedModuleId(groupedModules[0].id);
    }
  }, [groupedModules, selectedCourseId, initialLessonId, initialSelectedLessonId]);

  const activeModule = useMemo(() => {
    if (!groupedModules.length) return null;
    return groupedModules.find((m) => m.id === selectedModuleId) || groupedModules[0];
  }, [groupedModules, selectedModuleId]);

  const moduleLessons = useMemo(() => {
    if (!activeModule || !activeModule.rawLessons) return [];
    return activeModule.rawLessons.map((item, idx) => {
      const rawId = String(item.id || item.lessonId || '');
      const match = rawId.match(/L(\d+)/i);
      const lessonNum = match ? parseInt(match[1], 10) : idx + 1;
      const mappedTitle =
        customNames?.lessons?.[rawId] ||
        (item.title && item.title !== rawId ? item.title : `Lesson ${lessonNum}`);

      return {
        id: rawId,
        displayNum: lessonNum,
        title: mappedTitle,
        rawItem: item,
      };
    }).sort((a, b) => a.displayNum - b.displayNum);
  }, [activeModule]);

  // Ensure selectedLessonId belongs to the current moduleLessons
  useEffect(() => {
    if (!moduleLessons.length) return;

    const exists = moduleLessons.some((l) => l.id === selectedLessonId);
    if (!selectedLessonId || !exists) {
      const fallbackId = moduleLessons[0].id;
      setSelectedLessonId(fallbackId);
      try {
        const p = new URLSearchParams(window.location.search);
        p.set('lesson', fallbackId);
        p.delete('page');
        window.history.replaceState({}, '', `${window.location.pathname}?${p.toString()}`);
      } catch {}
    }
  }, [moduleLessons, selectedLessonId]);

  const handleSelectModule = (moduleId) => {
    setSelectedModuleId(moduleId);
    const targetMod = groupedModules.find((m) => m.id === moduleId);
    const firstLesson = targetMod?.rawLessons?.[0];
    const firstLessonId = String(firstLesson?.id || firstLesson?.lessonId || '').trim();
    if (firstLessonId) {
      setSelectedLessonId(firstLessonId);
    } else {
      setSelectedLessonId('');
    }
    setSelectedPageId('overview');
    try {
      const p = new URLSearchParams(window.location.search);
      if (firstLessonId) {
        p.set('lesson', firstLessonId);
      } else {
        p.delete('lesson');
      }
      p.delete('page');
      window.history.replaceState({}, '', `${window.location.pathname}?${p.toString()}`);
    } catch {}
  };

  const handleSelectLesson = (lessonId) => {
    setSelectedLessonId(lessonId);
    setSelectedPageId('overview');
    try {
      const p = new URLSearchParams(window.location.search);
      if (lessonId) {
        p.set('lesson', lessonId);
      } else {
        p.delete('lesson');
      }
      p.delete('page');
      window.history.replaceState({}, '', `${window.location.pathname}?${p.toString()}`);
    } catch {}
  };

  // Fetch selected lesson details (pages)
  const [selectedLessonData, setSelectedLessonData] = useState(null);

  useEffect(() => {
    if (!selectedLessonId) return;
    const lessonItem = activeModule?.rawLessons?.find((l) => l.id === selectedLessonId);
    const indexUrl = lessonItem?.index || `/courses/${selectedCourseId}/${selectedLessonId}/index.json`;

    fetch(indexUrl)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setSelectedLessonData(data);
      })
      .catch((err) => console.error('Failed to load lesson details:', err));
  }, [selectedLessonId, selectedCourseId, activeModule]);

  const activeLesson = useMemo(() => {
    if (!moduleLessons.length) return null;
    const found = moduleLessons.find((l) => l.id === selectedLessonId) || moduleLessons[0];
    if (!found) return null;

    const pages = selectedLessonData?.pages || [];
    const sortedPages = [...pages].sort((a, b) => {
      const pageNumA = parseInt(String(a.id || a.pageId || '').match(/_(\d+)$/)?.[1] || '0', 10);
      const pageNumB = parseInt(String(b.id || b.pageId || '').match(/_(\d+)$/)?.[1] || '0', 10);
      return pageNumA - pageNumB;
    });

    return {
      ...found,
      num: found.displayNum,
      pages: sortedPages,
    };
  }, [moduleLessons, selectedLessonId, selectedLessonData]);

  useEffect(() => {
    setSelectedPageId('overview');
    setClassProgressFilter('all');
    setSelectedStudent(null);
  }, [selectedModuleId, selectedLessonId]);

  const getStudentProgressForPage = (studentEmail, page) => {
    const taskCount = Number(page.taskCount) || 0;
    const pageId = page.id || page.pageId;

    const studentAttempts = dbAttempts.filter(
      (a) => a.user_id?.trim().toLowerCase() === studentEmail.trim().toLowerCase()
    );

    const correctTasks = new Set();
    studentAttempts.forEach((attempt) => {
      const isCompleted =
        attempt.status === 'completed' ||
        attempt.is_completed === true ||
        attempt.status === 'correct' ||
        String(attempt.feedback || '').toLowerCase().includes('correct');

      if (isCompleted && attempt.page_id === pageId && attempt.task_id) {
        correctTasks.add(attempt.task_id);
      }
    });

    const completed = correctTasks.size;
    const percentage = taskCount > 0
      ? Math.min(100, Math.round((completed / taskCount) * 100))
      : 0;

    return { percentage, completed, total: taskCount };
  };

  const getStudentProgressForLesson = (studentEmail, lesson) => {
    if (!lesson || !lesson.pages) return { percentage: 0, completed: 0, total: 0 };

    let totalTasks = 0;
    let completedTasks = 0;

    lesson.pages.forEach((page) => {
      const pageProg = getStudentProgressForPage(studentEmail, page);
      totalTasks += pageProg.total;
      completedTasks += pageProg.completed;
    });

    if (totalTasks === 0) return { percentage: 0, completed: 0, total: 0 };
    const percentage = Math.min(100, Math.round((completedTasks / totalTasks) * 100));

    return { percentage, completed: completedTasks, total: totalTasks };
  };

  const getProgressStatus = (percentage) => {
    if (percentage >= 100) {
      return { key: 'completed', label: 'Completed', description: 'All lesson tasks are complete.' };
    }
    if (percentage === 0) {
      return { key: 'not-started', label: 'Not started', description: 'No completed tasks in this lesson yet.' };
    }
    if (percentage < 25) {
      return { key: 'needs-attention', label: 'Needs attention', description: 'The student started but has made limited progress.' };
    }
    return { key: 'in-progress', label: 'In progress', description: 'The student is actively progressing through the lesson.' };
  };

  const activeModuleTitle = activeModule?.title || 'Select a module';
  const activeModuleCode = activeModule?.code
    ? (activeModule.isGraduation ? 'Graduation' : `Module ${activeModule.modNum}`)
    : 'Module 1';

  const classProgressRows = activeLesson
    ? students.map((student) => {
        const lessonProgress = getStudentProgressForLesson(student.email, activeLesson);
        const pageProgress = activeLesson.pages.map((page, index) => ({
          ...getStudentProgressForPage(student.email, page),
          id: page.id,
          page,
          pageNumber: index + 1,
        }));
        const status = getProgressStatus(lessonProgress.percentage);

        return {
          ...student,
          lessonProgress,
          pageProgress,
          status,
          pagesStarted: pageProgress.filter((page) => page.percentage > 0).length,
          pagesCompleted: pageProgress.filter((page) => page.percentage === 100).length,
        };
      })
    : [];

  const classAverage = classProgressRows.length
    ? Math.round(
        classProgressRows.reduce((sum, row) => sum + row.lessonProgress.percentage, 0) /
          classProgressRows.length
      )
    : 0;

  const completedCount = classProgressRows.filter((row) => row.status.key === 'completed').length;
  const inProgressCount = classProgressRows.filter((row) => row.status.key === 'in-progress').length;
  const needsAttentionCount = classProgressRows.filter(
    (row) => row.status.key === 'needs-attention'
  ).length;
  const notStartedCount = classProgressRows.filter((row) => row.status.key === 'not-started').length;

  const pageAverages = activeLesson
    ? activeLesson.pages.map((page, index) => {
        const total = classProgressRows.reduce(
          (sum, row) => sum + (row.pageProgress[index]?.percentage || 0),
          0
        );

        return {
          id: page.id,
          page,
          pageNumber: index + 1,
          average: classProgressRows.length ? Math.round(total / classProgressRows.length) : 0,
        };
      })
    : [];

  const hardestPage = pageAverages.length
    ? pageAverages.reduce((lowest, current) =>
        current.average < lowest.average ? current : lowest
      )
    : null;

  const totalCompletedTasks = classProgressRows.reduce(
    (sum, row) => sum + row.lessonProgress.completed,
    0
  );

  const lessonTaskCount = activeLesson
    ? activeLesson.pages.reduce((sum, page) => sum + (Number(page.taskCount) || 0), 0)
    : 0;

  const normalizedSearch = studentSearchQuery.trim().toLowerCase();
  const visibleClassRows = classProgressRows
    .filter((row) => {
      const matchesSearch =
        !normalizedSearch ||
        row.name.toLowerCase().includes(normalizedSearch) ||
        row.email.toLowerCase().includes(normalizedSearch);
      const matchesStatus =
        classProgressFilter === 'all' ||
        (classProgressFilter === 'action-required'
          ? row.status.key === 'needs-attention' || row.status.key === 'not-started'
          : row.status.key === classProgressFilter);

      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      if (classSortMode === 'name-asc') return a.name.localeCompare(b.name);
      if (classSortMode === 'name-desc') return b.name.localeCompare(a.name);
      if (classSortMode === 'progress-desc') return b.lessonProgress.percentage - a.lessonProgress.percentage;
      return a.lessonProgress.percentage - b.lessonProgress.percentage;
    });

  const selectedPage = activeLesson?.pages?.find((page) => page.id === selectedPageId) || null;
  const resetTargetPage = selectedPage || activeLesson?.pages?.[0] || null;

  const resetTargetPageNumber = resetTargetPage
    ? activeLesson.pages.findIndex((page) => page.id === resetTargetPage.id) + 1
    : 0;
  const selectedStudentRow = selectedStudent
    ? classProgressRows.find((row) => row.email === selectedStudent.email) || null
    : null;

  const openCoursePage = (page) => {
    const targetPage = page || selectedPage || activeLesson?.pages?.[0];
    if (!targetPage) {
      triggerToast('This lesson does not have a page to open yet.');
      return;
    }

    const lessonParam = activeLesson?.id || selectedLessonId;

    if (typeof onOpenPage === 'function') {
      onOpenPage(lessonParam, targetPage.id, selectedCourseId, 'classes');
      return;
    }

    const nextUrl = `/?course=${encodeURIComponent(selectedCourseId)}&lesson=${encodeURIComponent(lessonParam)}&page=${encodeURIComponent(targetPage.id)}&sourceTab=classes`;
    window.location.href = nextUrl;
  };

  const handleConfirmReset = () => {
    if (!resetTargetPage) return;
    const targetPageId = resetTargetPage.id;

    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes(targetPageId)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
    resetPageProgressInSupabase({ pageId: targetPageId });
    triggerToast('Reset progress successfully.');
  };

  const handleResetPageClick = () => {
    if (!resetTargetPage) {
      triggerToast('This lesson does not have a page to reset.');
      return;
    }

    const match = (selectedModuleData?.title || '').match(/^(M\d+)/i);
    const modDisplay = match ? `Module ${match[1].replace(/M/i, '')}` : (selectedModuleData?.title || selectedModuleId);
    const lessonDisplay = activeLesson?.title || `Lesson ${activeLesson?.num}`;
    const confirmed = window.confirm(
      `Reset progress for ${modDisplay}, Lesson ${lessonDisplay}, Page ${resetTargetPageNumber}?`
    );

    if (!confirmed) return;
    handleConfirmReset();
  };

  const handleUnlockLesson = () => {
    if (!activeLesson) {
      triggerToast('No lesson selected to unlock.');
      return;
    }
    if (!students || students.length === 0) {
      triggerToast('No students in this class to unlock for.');
      return;
    }
    if (!resolvedCourseId) {
      triggerToast('Class ID is not resolved yet.');
      return;
    }

    const topicId = String(activeLesson.num);
    const lessonTitle = activeLesson.title || `Lesson ${activeLesson.num}`;

    const confirmed = window.confirm(
      `System will unlock Lesson ${topicId} (${lessonTitle}) for the following students:\n\n` +
      students.map((s) => `- ${s.name}`).join('\n')
    );

    if (!confirmed) return;

    const supabaseToken = getValidSupabaseToken(supabaseKey);
    const checkUrl = `${supabaseUrl}/rest/v1/student_lesson_schedules?course_id=eq.${resolvedCourseId}&topic_id=eq.${topicId}&select=student_email`;

    fetch(checkUrl, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseToken}`
      }
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((existingSchedules) => {
        const existingEmails = new Set(
          (existingSchedules || []).map((s) => s.student_email?.toLowerCase().trim()).filter(Boolean)
        );

        const studentsToUnlock = students.filter(
          (s) => !existingEmails.has(s.email?.toLowerCase().trim())
        );

        if (studentsToUnlock.length === 0) {
          triggerToast(`Lesson ${topicId} is already unlocked for all students.`);
          return;
        }

        const payload = studentsToUnlock.map((s) => ({
          student_email: s.email,
          course_id: String(resolvedCourseId),
          topic_id: topicId,
          lms_course_id: selectedCourseId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }));

        const url = `${supabaseUrl}/rest/v1/student_lesson_schedules`;
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseToken}`
          },
          body: JSON.stringify(payload)
        })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            triggerToast(`Successfully unlocked Lesson ${topicId} for ${studentsToUnlock.length} student(s).`);
          })
          .catch((err) => {
            console.error('Unlock lesson error:', err);
            triggerToast('Failed to unlock lesson.');
          });
      });
  };

  const summaryCards = [
    { key: 'all', eyebrow: 'Class average', value: `${classAverage}%`, detail: `${students.length} student${students.length === 1 ? '' : 's'}`, icon: '↗' },
    { key: 'completed', eyebrow: 'Completed', value: completedCount, detail: 'Finished the lesson', icon: '✓' },
    { key: 'in-progress', eyebrow: 'In progress', value: inProgressCount, detail: 'At least 25% complete', icon: '▶' },
    { key: 'action-required', eyebrow: 'Needs attention', value: needsAttentionCount + notStartedCount, detail: 'Low progress or not started', icon: '!' }
  ];

  return (
    <div className="teacher-space-layout">
      {/* SIDEBAR */}
      <aside className="ts-sidebar">
        <div className="ts-brand">
          <div className="ts-brand-logo">
            A
          </div>
          <div className="ts-brand-text">
            <h2>Algo</h2>
            <p>TEACHER WORKSPACE</p>
          </div>
        </div>

        <div className="ts-nav-section">
          <div className="ts-section-title">TEACHER SPACE</div>
          <button
            type="button"
            className={`ts-nav-link ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <span>📊</span> Dashboard
          </button>
          <button
            type="button"
            className={`ts-nav-link ${activeTab === 'students' ? 'active' : ''}`}
            onClick={() => setActiveTab('students')}
          >
            <span>👤</span> Students
          </button>
        </div>

        <div className="ts-courses-accordion">
          <button
            type="button"
            className={`ts-accordion-header ${activeTab === 'classes' ? 'active' : ''}`}
            onClick={() => setMyClassesOpen(!myClassesOpen)}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>📚</span> My Classes
            </span>
            <span>{myClassesOpen ? '▾' : '▸'}</span>
          </button>

          {myClassesOpen && (
            <div className="ts-modules-list">
              <button
                type="button"
                className={`ts-module-button ${activeTab === 'classes' ? 'active' : ''}`}
                onClick={() => setActiveTab('classes')}
              >
                <span>★ {getCourseCodeDisplay(selectedCourseId)}</span>
              </button>
            </div>
          )}

          <div style={{ marginTop: '16px' }}>
            <button type="button" className="ts-nav-link" onClick={() => triggerToast('Calendar is coming soon')}>
              <span>📅</span> Calendar
            </button>
            <button type="button" className="ts-nav-link" onClick={() => triggerToast('Messages is coming soon')}>
              <span>💬</span> Messages
            </button>
            <button type="button" className="ts-nav-link" onClick={() => triggerToast('Resources is coming soon')}>
              <span>📁</span> Resources
            </button>
            <button type="button" className="ts-nav-link" onClick={() => triggerToast('Reports is coming soon')}>
              <span>📈</span> Reports
            </button>
          </div>
        </div>

        <div className="ts-profile-footer">
          <div className="ts-profile-avatar">
            {teacherDisplayName.charAt(0) || 'T'}
          </div>
          <div className="ts-profile-info">
            <strong>{teacherDisplayName}</strong>
            <span>TEACHER ACCOUNT</span>
            <button
              type="button"
              onClick={handleLogout}
              style={{ background: 'none', border: 'none', padding: 0, color: '#ef4444', fontSize: '11px', fontWeight: '700', cursor: 'pointer', textAlign: 'left', marginTop: '3px' }}
            >
              ↪ Log out
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="ts-main">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            style={{
              position: 'fixed', top: '20px', right: '20px', background: '#0f172a', color: '#fff',
              padding: '12px 20px', borderRadius: '10px', fontSize: '14px', fontWeight: '700',
              zIndex: 9999, boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
            }}
          >
            {toast.message}
          </div>
        ))}

        {activeTab === 'classes' && (
          <div className="td-class-page">
            {/* TOPBAR WITH BREADCRUMB & SEARCH */}
            <div className="td-topbar">
              <div className="td-welcome-block">
                <p className="td-welcome-text">
                  Good to see you, <strong>{teacherDisplayName}</strong>. Let's check how your students are progressing today.
                </p>
                <div className="td-breadcrumb">
                  <span>MY CLASSES</span>
                  <span className="td-breadcrumb-separator">/</span>
                  <strong>{getCourseCodeDisplay(selectedCourseId)}</strong>
                  <span className="td-breadcrumb-separator">/</span>
                  <span>{activeModuleCode}</span>
                  <span className="td-breadcrumb-separator">/</span>
                  <span>{activeModuleTitle}</span>
                </div>
              </div>

              <div className="td-search">
                <span className="td-search-icon">🔍</span>
                <input
                  type="text"
                  placeholder="Search students by name or email"
                  value={studentSearchQuery}
                  onChange={(e) => setStudentSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* MODULE PILLS HORIZONTAL BAR */}
            <div className="td-module-navigator">
              <span className="td-navigator-label">MODULES</span>
              <div className="td-module-scroll">
                {groupedModules.map((module) => {
                  const isSelected = module.id === selectedModuleId;
                  return (
                    <button
                      key={module.id}
                      type="button"
                      className={`td-module-chip ${isSelected ? 'active' : ''}`}
                      onClick={() => handleSelectModule(module.id)}
                    >
                      <span className="td-module-code">{module.code}</span>
                      <span className="td-module-name">{module.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* LESSON PILLS HORIZONTAL BAR */}
            <div className="td-lesson-strip">
              <span className="td-navigator-label">LESSONS</span>
              <div className="td-lesson-scroll">
                {moduleLessons.map((lesson) => {
                  const isSelected = lesson.id === activeLesson?.id;
                  const lessonProg = students.length > 0 && activeLesson && lesson.id === activeLesson.id
                    ? getStudentProgressForLesson(students[0].email, activeLesson)
                    : { percentage: 0 };

                  return (
                    <button
                      key={lesson.id}
                      type="button"
                      className={`td-lesson-tab ${isSelected ? 'active' : ''}`}
                      onClick={() => handleSelectLesson(lesson.id)}
                    >
                      <span className="td-lesson-number">L{lesson.displayNum}</span>
                      <span>{lesson.title}</span>
                      <span style={{ fontSize: '11px', opacity: 0.8, background: isSelected ? '#ede9fe' : '#f1f5f9', padding: '2px 6px', borderRadius: '99px' }}>
                        {lessonProg.percentage}%
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* HERO LESSON OVERVIEW CARD */}
            {activeLesson && (
              <div className="td-hero">
                <div className="td-hero-copy">
                  <div className="td-hero-kicker">
                    <span>{activeModuleCode}</span>
                    <span>•</span>
                    <span>{activeModuleTitle}</span>
                  </div>
                  <h1>{activeLesson.title}</h1>
                  <p className="td-hero-description">
                    See who is progressing, who has not started, and where the class may need support before the next session.
                  </p>
                  <div className="td-hero-meta">
                    <span className="td-meta-pill">
                      <span className="td-meta-dot" />
                      {students.length} student{students.length === 1 ? '' : 's'}
                    </span>
                    <span className="td-meta-pill">
                      {activeLesson.pages?.length || 0} pages
                    </span>
                    <span className="td-meta-pill">
                      {lessonTaskCount} tasks per student
                    </span>
                  </div>
                </div>

                <div className="td-hero-side">
                  <div className="td-hero-score">
                    <strong>{classAverage}%</strong>
                    <span>class average</span>
                  </div>

                  <div className="td-hero-actions">
                    <button
                      type="button"
                      className="td-button secondary"
                      onClick={handleUnlockLesson}
                    >
                      🔓 Unlock Lesson
                    </button>

                    <button
                      type="button"
                      className="td-button secondary"
                      onClick={handleResetPageClick}
                    >
                      ↺ Reset progress
                    </button>

                    <button
                      type="button"
                      className="td-button primary"
                      onClick={() => openCoursePage()}
                    >
                      ↗ Open lesson
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* KPI SUMMARY CARDS (4 CARDS) */}
            <div className="td-summary-grid">
              {summaryCards.map((card) => {
                const isActive = classProgressFilter === card.key;

                return (
                  <button
                    key={card.key}
                    type="button"
                    className={`td-summary-card ${isActive ? 'active' : ''}`}
                    onClick={() => setClassProgressFilter(card.key)}
                  >
                    <div className="td-summary-icon">{card.icon}</div>
                    <div className="td-summary-copy">
                      <span className="td-summary-eyebrow">{card.eyebrow}</span>
                      <span className="td-summary-value">{card.value}</span>
                      <span className="td-summary-detail">{card.detail}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* STUDENT PROGRESS TABLE SECTION */}
            <div className="td-workspace">
              <div className="td-progress-panel">
                <div className="td-panel-heading">
                  <div>
                    <h2>Student progress</h2>
                    <p>Compare lesson progress across all pages.</p>
                  </div>
                </div>

                {/* PAGE SELECTOR SUB-TABS */}
                {activeLesson && activeLesson.pages.length > 0 && (
                  <div className="td-page-tabs">
                    <button
                      type="button"
                      className={`td-page-tab ${selectedPageId === 'overview' ? 'active' : ''}`}
                      onClick={() => setSelectedPageId('overview')}
                    >
                      Overview
                    </button>
                    {activeLesson.pages.map((page, index) => (
                      <button
                        key={page.id}
                        type="button"
                        className={`td-page-tab ${selectedPageId === page.id ? 'active' : ''}`}
                        onClick={() => setSelectedPageId(page.id)}
                      >
                        Page {index + 1}
                      </button>
                    ))}
                  </div>
                )}

                {/* TOOLBAR */}
                <div className="td-table-toolbar">
                  <span className="td-result-count">
                    Showing {visibleClassRows.length} of {classProgressRows.length} student{classProgressRows.length === 1 ? '' : 's'}
                  </span>

                  <div className="td-toolbar-actions">
                    {classProgressFilter !== 'all' && (
                      <button
                        type="button"
                        className="td-clear-filter"
                        onClick={() => setClassProgressFilter('all')}
                      >
                        Clear filter
                      </button>
                    )}

                    <select
                      className="td-select"
                      value={classSortMode}
                      onChange={(e) => setClassSortMode(e.target.value)}
                    >
                      <option value="progress-asc">Lowest progress first</option>
                      <option value="progress-desc">Highest progress first</option>
                      <option value="name-asc">Name A-Z</option>
                      <option value="name-desc">Name Z-A</option>
                    </select>
                  </div>
                </div>

                {/* TABLE */}
                <div className="td-table-wrap">
                  <table className="td-progress-table">
                    <thead>
                      <tr>
                        <th style={{ padding: '14px 20px', fontSize: '11.5px', fontWeight: '900', color: '#64748b', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>STUDENT</th>
                        <th style={{ padding: '14px 20px', fontSize: '11.5px', fontWeight: '900', color: '#64748b', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>STATUS</th>
                        <th style={{ padding: '14px 20px', fontSize: '11.5px', fontWeight: '900', color: '#64748b', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>OVERALL PROGRESS</th>
                        {(activeLesson?.pages || []).map((page, idx) => (
                          <th key={page.id} style={{ padding: '14px 20px', fontSize: '11.5px', fontWeight: '900', color: '#64748b', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                            PAGE {idx + 1}
                          </th>
                        ))}
                        <th style={{ padding: '14px 20px', fontSize: '11.5px', fontWeight: '900', color: '#64748b', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleClassRows.map((row) => {
                        const isSelected = selectedStudentRow?.email === row.email;

                        return (
                          <tr
                            key={row.email}
                            className={`ts-student-row ${isSelected ? 'selected' : ''}`}
                            onClick={() => setSelectedStudent(row)}
                            style={{ borderBottom: '1px solid #f1f5f9' }}
                          >
                            <td style={{ padding: '16px 20px' }}>
                              <div className="ts-student-cell">
                                <div className="ts-student-avatar">
                                  {row.name.charAt(0)}
                                </div>
                                <div>
                                  <strong style={{ display: 'block', fontSize: '14px', color: '#0f172a' }}>{row.name}</strong>
                                  <small style={{ color: '#64748b', fontSize: '11.5px' }}>{row.email}</small>
                                </div>
                              </div>
                            </td>

                            <td style={{ padding: '16px 20px' }}>
                              <span
                                className={`ts-badge ${
                                  row.status.key === 'completed'
                                    ? 'completed'
                                    : row.status.key === 'needs-attention'
                                    ? 'partial'
                                    : 'empty'
                                }`}
                              >
                                {row.status.label}
                              </span>
                            </td>

                            <td style={{ padding: '16px 20px' }}>
                              <div className="ts-progress-bar-container">
                                <div className="ts-progress-bar">
                                  <div
                                    className="ts-progress-fill"
                                    style={{ width: `${row.lessonProgress.percentage}%` }}
                                  />
                                </div>
                                <span className="ts-progress-percent">
                                  {row.lessonProgress.percentage}%
                                </span>
                              </div>
                            </td>

                            {(row.pageProgress || []).map((pageProg, idx) => (
                              <td key={idx} style={{ padding: '16px 20px' }}>
                                <span
                                  style={{
                                    display: 'inline-flex', padding: '4px 9px', borderRadius: '999px',
                                    fontSize: '12px', fontWeight: '800',
                                    background: pageProg.percentage === 100 ? '#dcfce7' : pageProg.percentage > 0 ? '#fef3c7' : '#f1f5f9',
                                    color: pageProg.percentage === 100 ? '#065f46' : pageProg.percentage > 0 ? '#92400e' : '#64748b'
                                  }}
                                >
                                  {pageProg.percentage}%
                                </span>
                              </td>
                            ))}

                            <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                              <button
                                type="button"
                                style={{
                                  padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '8px',
                                  background: '#fff', color: '#475569', fontSize: '12.5px', fontWeight: '800', cursor: 'pointer'
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedStudent(row);
                                  setActiveTab('students');
                                }}
                              >
                                View details
                              </button>
                            </td>
                          </tr>
                        );
                      })}

                      {visibleClassRows.length === 0 && (
                        <tr>
                          <td colSpan={4 + (activeLesson?.pages?.length || 0)} style={{ padding: '36px', textAlign: 'center', color: '#64748b' }}>
                            No students match the selected filter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* TABLE FOOTER SUMMARY */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', background: '#fafbfd', borderTop: '1px solid #edf0f4', fontSize: '13px', color: '#64748b', fontWeight: '700' }}>
                  <div>
                    MOST DIFFICULT PAGE: <strong style={{ color: '#0f172a' }}>{hardestPage ? `Page ${hardestPage.pageNumber} - ${hardestPage.average}% avg.` : 'N/A'}</strong>
                  </div>
                  <div>
                    COMPLETED TASKS: <strong style={{ color: '#0f172a' }}>{totalCompletedTasks} across the class</strong>
                  </div>
                  <div>
                    TEACHER FOCUS: <strong style={{ color: '#7c3aed' }}>Class is on track</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB: STUDENTS DIRECTORY */}
        {activeTab === 'students' && (
          <div style={{ padding: '36px', display: 'flex', gap: '28px' }}>
            <div style={{ width: '320px', background: '#fff', borderRadius: '18px', border: '1px solid #e2e8f0', padding: '20px', flexShrink: 0 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '18px', fontWeight: '800' }}>Students Directory</h3>
              <input
                type="text"
                placeholder="Search students..."
                value={studentSearchQuery}
                onChange={(e) => setStudentSearchQuery(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', marginBottom: '16px' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '60vh', overflowY: 'auto' }}>
                {students.filter(s => !studentSearchQuery || s.name.toLowerCase().includes(studentSearchQuery.toLowerCase())).map((student) => (
                  <button
                    key={student.email}
                    type="button"
                    onClick={() => setSelectedStudent(student)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '10px',
                      border: '1px solid #f1f5f9', background: selectedStudent?.email === student.email ? '#f5f3ff' : '#fff',
                      textAlign: 'left', cursor: 'pointer'
                    }}
                  >
                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#ede9fe', color: '#7c3aed', display: 'grid', placeItems: 'center', fontWeight: '800' }}>
                      {student.name.charAt(0)}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <strong style={{ display: 'block', fontSize: '14px', color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{student.name}</strong>
                      <small style={{ color: '#64748b', fontSize: '11px' }}>{student.email}</small>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ flex: 1, background: '#fff', borderRadius: '18px', border: '1px solid #e2e8f0', padding: '28px' }}>
              {selectedStudent ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '20px', marginBottom: '24px' }}>
                    <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: '22px', fontWeight: '800' }}>
                      {selectedStudent.name.charAt(0)}
                    </div>
                    <div>
                      <h2 style={{ margin: 0, fontSize: '22px', fontWeight: '800' }}>{selectedStudent.name}</h2>
                      <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '14px' }}>{selectedStudent.email}</p>
                    </div>
                  </div>

                  <h4 style={{ fontSize: '16px', fontWeight: '800', marginBottom: '16px' }}>Student Performance</h4>
                  <p style={{ color: '#64748b', fontSize: '14px' }}>Select lessons in My Classes to review detailed task submissions for {selectedStudent.name}.</p>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '56px', color: '#64748b' }}>Select a student from the directory to view details.</div>
              )}
            </div>
          </div>
        )}

        {/* TAB: PREVIEW MODE */}
        {activeTab === 'preview' && (
          <div style={{ padding: '28px' }}>
            <TeacherCoursePreview courseId={selectedCourseId} onOpenPage={onOpenPage} />
          </div>
        )}
      </div>
    </div>
  );
}
