import { useEffect, useMemo, useState } from 'react';

function getPageCatalogUrl(courseId, lessonId) {
  return `/courses/${encodeURIComponent(courseId)}/${encodeURIComponent(lessonId)}/index.json`;
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

function getPageStats(page) {
  const taskCount = Number.isFinite(page.taskCount) ? page.taskCount : 0;
  const stateCount = Number.isFinite(page.stateCount) ? page.stateCount : 0;

  return `${taskCount} tasks / ${stateCount} states`;
}

export default function PageCatalog({
  courseId,
  lessonId,
  onOpenPage,
  onBackToLessons,
  onBackToCourses,
}) {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');

  const catalogUrl = useMemo(
    () => getPageCatalogUrl(courseId, lessonId),
    [courseId, lessonId],
  );

  useEffect(() => {
    setCatalog(null);
    setError('');

    if (!courseId || !lessonId) return;

    fetch(catalogUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`Cannot load ${catalogUrl}`);
        return res.json();
      })
      .then(setCatalog)
      .catch((err) => setError(err.message));
  }, [courseId, lessonId, catalogUrl]);

  const pages = useMemo(() => {
    if (!Array.isArray(catalog?.pages)) return [];
    return catalog.pages;
  }, [catalog]);

  if (error) {
    return (
      <main className="catalog-screen">
        <section className="catalog-hero">
          <button
            type="button"
            className="catalog-inline-back"
            onClick={onBackToLessons}
          >
            ← Back to lessons
          </button>

          <p className="catalog-eyebrow">LMS Replica</p>
          <h1>Page catalog not found</h1>
          <p>Không tìm thấy page list cho lesson này.</p>

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
            onClick={onBackToLessons}
          >
            ← Back to lessons
          </button>

          <p className="catalog-eyebrow">LMS Replica</p>
          <h1>Loading pages...</h1>
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
          onClick={onBackToLessons}
        >
          ← Back to lessons
        </button>

        <button
          type="button"
          className="catalog-inline-back"
          onClick={onBackToCourses}
        >
          ← Back to courses
        </button>

        <p className="catalog-eyebrow">Lesson</p>
        <h1>{catalog.title || lessonId}</h1>
        <p>Chọn page trong lesson này để mở renderer.</p>

        <div className="catalog-meta">
          <span>{pages.length} page(s)</span>
          <span>{catalog.taskCount || 0} tasks</span>
          <span>{catalog.stateCount || 0} states</span>
          {catalog.generatedAt ? <span>Updated: {formatDate(catalog.generatedAt)}</span> : null}
        </div>
      </section>

      {pages.length === 0 ? (
        <section className="catalog-empty">
          <h2>No pages imported yet</h2>
          <p>Thêm ZIP vào lesson folder rồi chạy:</p>
          <pre>npm run import</pre>
        </section>
      ) : (
        <section className="course-grid">
          {pages.map((page, index) => (
            <button
              key={page.id || index}
              type="button"
              className="course-card lesson-card"
              onClick={() => onOpenPage(page)}
            >
              <div className="course-card-top">
                <span className="course-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="course-stats">{getPageStats(page)}</span>
              </div>

              <h2>{page.title || page.id}</h2>

              {page.sourceZip ? (
                <p className="course-source">{page.sourceZip}</p>
              ) : null}

              <div className="course-card-footer">
                <span>Open page</span>
                <span aria-hidden="true">→</span>
              </div>
            </button>
          ))}
        </section>
      )}
    </main>
  );
}