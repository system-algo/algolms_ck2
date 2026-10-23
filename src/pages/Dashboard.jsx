import { useEffect, useMemo, useState } from 'react';
import './Dashboard.css';

const DEFAULT_COURSE_ID = 'GD';

function getHeaders() {
  const key = localStorage.getItem('lms_supabase_key') || '';
  const token = localStorage.getItem('lms_access_token') || '';
  const headers = { apikey: key };
  if (token && token.split('.').length === 3) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function lessonNumberFromId(id) {
  const match = String(id || '').match(/^GD_M(\d+)L(\d+)$/i);
  return match ? (Number(match[1]) * 100 + Number(match[2])) : 9999;
}

export default function Dashboard({ initialCourseId = DEFAULT_COURSE_ID, onOpenPage }) {
  const [course, setCourse] = useState(null);
  const [lessonPages, setLessonPages] = useState({});
  const [selectedLessonId, setSelectedLessonId] = useState('');
  const [unlocked, setUnlocked] = useState(new Set([1, 2]));
  const [completedThrough, setCompletedThrough] = useState(0);
  const [loading, setLoading] = useState(true);

  const courseId = String(initialCourseId || DEFAULT_COURSE_ID).trim().toUpperCase();
  const studentEmail = (localStorage.getItem('lms_student_email') || '').trim().toLowerCase();
  const displayName = studentEmail
    ? studentEmail.split('@')[0].split(/[._-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
    : 'Student';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/courses/${encodeURIComponent(courseId)}/index.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Cannot load ${courseId}`);
        return res.json();
      })
      .then(async (data) => {
        if (cancelled) return;
        const lessons = Array.isArray(data.lessons) ? [...data.lessons] : [];
        lessons.sort((a, b) => lessonNumberFromId(a.id) - lessonNumberFromId(b.id));
        setCourse({ ...data, lessons });
        const entries = await Promise.all(
          lessons.map(async (lesson) => {
            try {
              const response = await fetch(`/courses/${encodeURIComponent(courseId)}/${encodeURIComponent(lesson.id)}/index.json`);
              const detail = response.ok ? await response.json() : { pages: [] };
              return [lesson.id, Array.isArray(detail.pages) ? detail.pages : []];
            } catch {
              return [lesson.id, []];
            }
          }),
        );
        if (!cancelled) {
          setLessonPages(Object.fromEntries(entries));
          setSelectedLessonId(lessons[0]?.id || '');
        }
      })
      .catch((error) => console.error(error))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [courseId]);

  useEffect(() => {
    const supabaseUrl = localStorage.getItem('lms_supabase_url');
    const supabaseKey = localStorage.getItem('lms_supabase_key');
    if (!supabaseUrl || !supabaseKey || !studentEmail) return;

    const url = `${supabaseUrl}/rest/v1/student_lesson_schedules?student_email=eq.${encodeURIComponent(studentEmail)}&lms_course_id=eq.${encodeURIComponent(courseId)}&select=topic_id`;
    fetch(url, { headers: getHeaders() })
      .then((res) => res.ok ? res.json() : [])
      .then((rows) => {
        let highest = 2;
        (Array.isArray(rows) ? rows : []).forEach((row) => {
          const n = Number(row.topic_id);
          if (Number.isInteger(n)) highest = Math.max(highest, n);
        });
        const next = new Set();
        for (let n = 1; n <= highest; n += 1) next.add(n);
        setUnlocked(next);
      })
      .catch(() => setUnlocked(new Set([1, 2])));
  }, [courseId, studentEmail]);

  // Group-specific Odoo completion position, checked against the signed-in user.
  useEffect(() => {
    let cancelled = false;
    setCompletedThrough(0);
    const url = localStorage.getItem('lms_supabase_url') || '';
    const key = localStorage.getItem('lms_supabase_key') || '';
    const token = localStorage.getItem('lms_access_token') || '';
    if (courseId !== 'GD' || !url || !key || !studentEmail || token.split('.').length !== 3) {
      return undefined;
    }

    const load = async () => {
      const membersUrl = `${url}/rest/v1/classroom_course_members` +
        `?email=eq.${encodeURIComponent(studentEmail)}&role=eq.student&course_code=eq.GD&select=course_id`;
      const membersResponse = await fetch(membersUrl, { headers: getHeaders() });
      if (!membersResponse.ok) throw new Error('Unable to find GD enrollment');
      const memberships = await membersResponse.json();
      if (!Array.isArray(memberships) || memberships.length !== 1) return;

      const classroomId = String(memberships[0].course_id || '');
      const historyUrl = `${url}/rest/v1/student_historical_course_progress` +
        `?classroom_course_id=eq.${encodeURIComponent(classroomId)}` +
        '&lms_course_id=eq.GD&select=completed_through';
      const response = await fetch(historyUrl, { headers: getHeaders() });
      if (!response.ok) throw new Error('Unable to load GD completion');
      const rows = await response.json();
      const through = Number(rows?.[0]?.completed_through);
      if (!cancelled && Number.isInteger(through) && through >= 0 && through <= 32) {
        setCompletedThrough(through);
      }
    };

    load().catch((error) => {
      if (!cancelled) console.warn('GD progress unavailable:', error);
    });
    return () => { cancelled = true; };
  }, [courseId, studentEmail]);

  const lessons = course?.lessons || [];
  const selectedLesson = lessons.find((lesson) => lesson.id === selectedLessonId) || lessons[0] || null;
  const pages = selectedLesson ? (lessonPages[selectedLesson.id] || []) : [];

  const completedCount = useMemo(() => {
    let count = 0;
    const prefix = studentEmail
      ? `lms-completed-tasks:v2:${studentEmail}:${courseId}:`
      : `lms-completed-tasks:v2:`;
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) count += 1;
      }
    } catch { /* ignore */ }
    return count;
  }, [courseId, studentEmail, lessonPages]);

  if (loading) return <div className="lms-loading">Getting your learning space ready...</div>;

  return (
    <main className="student-shell">
      <aside className="student-sidebar">
        <div className="student-brand"><span className="brand-mark">A</span><div><strong>Algo</strong><small>LEARNING SPACE</small></div></div>
        <div className="sidebar-section-title">MY COURSES</div>
        <button className="sidebar-course active" type="button"><span>▣</span>{courseId}</button>
        <div className="sidebar-spacer" />
        <div className="student-account"><span className="student-avatar">{displayName.charAt(0) || 'S'}</span><div><strong>{displayName}</strong><small>Student</small></div></div>
      </aside>

      <section className="student-main">
        <header className="student-header">
          <div><p>Ready for your next challenge,</p><h1>{displayName} 👋</h1><span>Continue your learning journey today.</span></div>
          <div className="course-chip"><small>CURRENT COURSE</small><strong>{courseId}</strong></div>
        </header>

        <div className="student-grid">
          <section className="student-panel lesson-panel">
            <div className="panel-heading"><div><small>COURSE CONTENT</small><h2>{course?.title || courseId}</h2></div><span>{lessons.length} lessons</span></div>
            <div className="lesson-list">
              {lessons.map((lesson, index) => {
                const n = index + 1;
                const isUnlocked = unlocked.has(n) || n <= completedThrough;
                const isCompleted = n <= completedThrough;
                return (
                  <button key={lesson.id} type="button" className={`lesson-row${selectedLessonId === lesson.id ? ' active' : ''}${!isUnlocked ? ' locked' : ''}${isCompleted ? ' completed' : ''}`} onClick={() => isUnlocked && setSelectedLessonId(lesson.id)}>
                    <span className="lesson-number">{n}</span><span className="lesson-copy"><strong>{lesson.title || lesson.id}</strong><small>{lesson.pageCount || (lessonPages[lesson.id] || []).length} pages</small></span><span>{isCompleted ? '✓' : isUnlocked ? '›' : '🔒'}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="student-panel page-panel">
            <div className="panel-heading"><div><small>SELECTED LESSON</small><h2>{selectedLesson?.title || 'Choose a lesson'}</h2></div></div>
            <div className="page-list">
              {pages.length === 0 ? <div className="empty-card">No pages found for this lesson.</div> : pages.map((page, index) => (
                <button key={page.id || page.pageId || index} type="button" className="page-card" onClick={() => onOpenPage?.(selectedLesson.id, page.id || page.pageId)}>
                  <span className="page-icon">▶</span><div><strong>{page.title || page.name || `Page ${index + 1}`}</strong><small>Open activity page</small></div><span>›</span>
                </button>
              ))}
            </div>
          </section>

          <aside className="student-panel progress-panel">
            <small>COURSE PROGRESS</small><div className="progress-ring"><strong>{completedThrough || completedCount}</strong><span>{completedThrough ? 'of 32 lessons' : 'saved pages'}</span></div><p>Your progress is saved as you complete activities.</p>
          </aside>
        </div>
      </section>
    </main>
  );
}
