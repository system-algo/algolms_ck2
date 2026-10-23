import { useEffect, useMemo, useState } from 'react';

const CATALOG_URL = '/courses/index.json';

function formatDate(value) {
  if (!value) return '';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getCourseStats(course) {
  const lessonCount = Number.isFinite(course.lessonCount) ? course.lessonCount : 0;
  const taskCount = Number.isFinite(course.taskCount) ? course.taskCount : 0;
  const stateCount = Number.isFinite(course.stateCount) ? course.stateCount : 0;

  return `${lessonCount} lessons / ${taskCount} tasks / ${stateCount} states`;
}

export default function CourseCatalog({ onOpenCourse }) {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(CATALOG_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Cannot load ${CATALOG_URL}`);
        return res.json();
      })
      .then(setCatalog)
      .catch((err) => setError(err.message));
  }, []);

  const courses = useMemo(() => {
    if (!Array.isArray(catalog?.courses)) return [];
    return catalog.courses;
  }, [catalog]);

  if (error) {
    return (
      <main className="catalog-screen">
        <section className="catalog-hero">
          <p className="catalog-eyebrow">LMS Replica</p>
          <h1>Course catalog not found</h1>
          <p>
            Chưa có file course catalog. Chạy import trước để tạo danh sách course.
          </p>

          <pre>npm run import</pre>
        </section>

        <section className="catalog-empty">
          <p>{error}</p>
        </section>
      </main>
    );
  }

  if (!catalog) {
    return (
      <main className="catalog-screen">
        <section className="catalog-hero">
          <p className="catalog-eyebrow">LMS Replica</p>
          <h1>Loading courses...</h1>
        </section>
      </main>
    );
  }

  return (
    <main className="catalog-screen">
      <section className="catalog-hero">
        <p className="catalog-eyebrow">LMS Replica</p>
        <h1>Course Catalog</h1>
        <p>
          Chọn một course bên dưới để xem danh sách lesson. Sau này thêm ZIP vào
          đúng folder course trong input rồi chạy import, course/lesson mới sẽ tự hiện ở đây.
        </p>

        <div className="catalog-meta">
          <span>{courses.length} course(s)</span>
          {catalog.generatedAt ? <span>Updated: {formatDate(catalog.generatedAt)}</span> : null}
        </div>
      </section>

      {courses.length === 0 ? (
        <section className="catalog-empty">
          <h2>No courses imported yet</h2>
          <p>Tạo folder course trong input, bỏ ZIP vào đó rồi chạy:</p>
          <pre>npm run import</pre>
        </section>
      ) : (
        <section className="course-grid">
          {courses.map((course, index) => (
            <button
              key={course.id || index}
              type="button"
              className="course-card"
              onClick={() => onOpenCourse(course.id)}
            >
              <div className="course-card-top">
                <span className="course-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="course-stats">{getCourseStats(course)}</span>
              </div>

              <h2>{course.title || course.id}</h2>

              <p className="course-source">
                {course.lessonCount || 0} lesson(s) inside this course
              </p>

              <div className="course-card-footer">
                <span>Open course</span>
                <span aria-hidden="true">→</span>
              </div>
            </button>
          ))}
        </section>
      )}
    </main>
  );
}