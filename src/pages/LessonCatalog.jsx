import { useEffect, useMemo, useState } from 'react';

function getLessonCatalogUrl(courseId) {
  return `/courses/${encodeURIComponent(courseId)}/index.json`;
}

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

function getLessonStats(lesson) {
  const pageCount = Number.isFinite(lesson.pageCount) ? lesson.pageCount : 0;
  const taskCount = Number.isFinite(lesson.taskCount) ? lesson.taskCount : 0;
  const stateCount = Number.isFinite(lesson.stateCount) ? lesson.stateCount : 0;

  return `${pageCount} pages / ${taskCount} tasks / ${stateCount} states`;
}

export default function LessonCatalog({
  courseId,
  onOpenLesson,
  onBackToCatalog,
}) {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');

  const catalogUrl = useMemo(() => getLessonCatalogUrl(courseId), [courseId]);

  useEffect(() => {
    setCatalog(null);
    setError('');

    if (!courseId) return;

    fetch(catalogUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`Cannot load ${catalogUrl}`);
        return res.json();
      })
      .then(setCatalog)
      .catch((err) => setError(err.message));
  }, [courseId, catalogUrl]);

  const lessons = useMemo(() => {
    if (!Array.isArray(catalog?.lessons)) return [];
    return catalog.lessons;
  }, [catalog]);

  if (error) {
    return (
      <main className="catalog-screen">
        <section className="catalog-hero">
          <button
            type="button"
            className="catalog-inline-back"
            onClick={onBackToCatalog}
          >
            ← Back to courses
          </button>

          <p className="catalog-eyebrow">LMS Replica</p>
          <h1>Lesson catalog not found</h1>
          <p>Không tìm thấy lesson list cho course này.</p>

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
          <button
            type="button"
            className="catalog-inline-back"
            onClick={onBackToCatalog}
          >
            ← Back to courses
          </button>

          <p className="catalog-eyebrow">LMS Replica</p>
          <h1>Loading lessons...</h1>
        </section>
      </main>
    );
  }

  return (
    <main className="catalog-screen">
      <section className="catalog-hero">
        <button
          type="button"
          className="catalog-inline-back"
          onClick={onBackToCatalog}
        >
          ← Back to courses
        </button>

        <p className="catalog-eyebrow">Course</p>
        <h1>{catalog.title || courseId}</h1>
        <p>Chọn lesson trước, sau đó chọn page trong lesson đó.</p>

        <div className="catalog-meta">
          <span>{lessons.length} lesson(s)</span>
          <span>{catalog.pageCount || 0} pages</span>
          <span>{catalog.taskCount || 0} tasks</span>
          <span>{catalog.stateCount || 0} states</span>
          {catalog.generatedAt ? <span>Updated: {formatDate(catalog.generatedAt)}</span> : null}
        </div>
      </section>

      {lessons.length === 0 ? (
        <section className="catalog-empty">
          <h2>No lessons imported yet</h2>
          <p>Thêm ZIP vào input rồi chạy:</p>
          <pre>npm run import</pre>
        </section>
      ) : (
        <section className="course-grid">
          {lessons.map((lesson, index) => (
            <button
              key={lesson.id || index}
              type="button"
              className="course-card lesson-card"
              onClick={() => onOpenLesson(lesson)}
            >
              <div className="course-card-top">
                <span className="course-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="course-stats">{getLessonStats(lesson)}</span>
              </div>

              <h2>{lesson.title || lesson.id}</h2>

              <div className="course-card-footer">
                <span>Open pages</span>
                <span aria-hidden="true">→</span>
              </div>
            </button>
          ))}
        </section>
      )}
    </main>
  );
}