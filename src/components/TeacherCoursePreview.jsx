import React, { useState, useEffect, useMemo } from 'react';
import '../pages/StudentHomeDashboard.css';
import '../pages/TeacherDashboard.css';
import customNames from '../config/mapping.json';

export default function TeacherCoursePreview({ courseId = 'GD', onOpenPage }) {
  const [lessonsData, setLessonsData] = useState([]);
  const [loadingLessons, setLoadingLessons] = useState(true);
  const [selectedModuleIndex, setSelectedModuleIndex] = useState(0);
  const [selectedLessonIndex, setSelectedLessonIndex] = useState(0);

  useEffect(() => {
    if (!courseId) return;

    setLoadingLessons(true);
    fetch(`/courses/${encodeURIComponent(courseId)}/index.json`)
      .then((r) => {
        if (!r.ok) throw new Error('Cannot load course index');
        return r.json();
      })
      .then(async (data) => {
        const rawItems = data.lessons || [];

        // Group raw lesson items into modules
        const modMap = new Map();
        rawItems.forEach((item) => {
          const rawId = String(item.id || item.lessonId || '');
          const isGrad = /aftergrad|graduation/i.test(rawId);
          const modMatch = rawId.match(/_M(\d+)/i) || rawId.match(/M(\d+)/i);
          const modNum = isGrad ? 99 : modMatch ? parseInt(modMatch[1], 10) : 1;
          const modKey = isGrad ? `${courseId}_Graduation` : `${courseId}_M${modNum}`;

          if (!modMap.has(modKey)) {
            const mappedTitle = customNames?.modules?.[modKey] || (isGrad ? 'Graduation' : `Module ${modNum}`);
            modMap.set(modKey, {
              id: modKey,
              modNum,
              code: isGrad ? 'GR' : `${modNum}`,
              title: mappedTitle,
              isGraduation: isGrad,
              rawLessons: []
            });
          }
          modMap.get(modKey).rawLessons.push(item);
        });

        const sortedModules = Array.from(modMap.values()).sort((a, b) => a.modNum - b.modNum);

        // Fetch each lesson's index in parallel
        const structuredModules = await Promise.all(
          sortedModules.map(async (mod, modIdx) => {
            const moduleNumber = mod.isGraduation ? 'GR' : modIdx + 1;

            const lessons = await Promise.all(
              mod.rawLessons.map(async (rawLesson, idx) => {
                const lessonId = String(rawLesson.id || rawLesson.lessonId || '');
                const match = lessonId.match(/L(\d+)/i);
                const lessonNum = match ? parseInt(match[1], 10) : idx + 1;
                const mappedTitle =
                  customNames?.lessons?.[lessonId] ||
                  (rawLesson.title && rawLesson.title !== lessonId ? rawLesson.title : `Lesson ${lessonNum}`);

                const indexUrl = rawLesson.index || `/courses/${encodeURIComponent(courseId)}/${encodeURIComponent(lessonId)}/index.json`;
                let pages = [];
                try {
                  const r = await fetch(indexUrl);
                  if (r.ok) {
                    const lData = await r.json();
                    pages = lData.pages || [];
                  }
                } catch (e) {
                  console.error(e);
                }

                pages.sort((a, b) => {
                  const pageNumA = parseInt(String(a.id || '').match(/_(\d+)$/)?.[1] || '0', 10);
                  const pageNumB = parseInt(String(b.id || '').match(/_(\d+)$/)?.[1] || '0', 10);
                  return pageNumA - pageNumB;
                });

                return {
                  key: lessonId,
                  moduleId: lessonId,
                  number: lessonNum,
                  title: mappedTitle,
                  pages
                };
              })
            );

            const totalPageCount = lessons.reduce((acc, l) => acc + l.pages.length, 0);

            return {
              id: mod.id,
              title: mod.title,
              number: moduleNumber,
              isGraduation: mod.isGraduation,
              lessons,
              pageCount: totalPageCount
            };
          })
        );

        setLessonsData(structuredModules);
        setLoadingLessons(false);
        setSelectedModuleIndex(0);
        setSelectedLessonIndex(0);
      })
      .catch((err) => {
        console.error('Error fetching lessons:', err);
        setLoadingLessons(false);
      });
  }, [courseId]);

  const activeModule = useMemo(() => {
    if (lessonsData.length > 0 && selectedModuleIndex >= 0 && selectedModuleIndex < lessonsData.length) {
      return lessonsData[selectedModuleIndex];
    }
    return null;
  }, [lessonsData, selectedModuleIndex]);

  const activeLesson = useMemo(() => {
    if (activeModule && activeModule.lessons.length > 0 && selectedLessonIndex >= 0 && selectedLessonIndex < activeModule.lessons.length) {
      return activeModule.lessons[selectedLessonIndex];
    }
    return null;
  }, [activeModule, selectedLessonIndex]);

  const handleLaunchPage = (moduleId, pageId) => {
    if (typeof onOpenPage === 'function') {
      onOpenPage(moduleId, pageId);
    } else {
      window.location.href = `/?course=${encodeURIComponent(courseId)}&lesson=${encodeURIComponent(moduleId)}&page=${encodeURIComponent(pageId)}`;
    }
  };

  const handleLaunchFirstPageOfLesson = (lesson) => {
    if (lesson?.pages?.length > 0) {
      const firstPage = lesson.pages[0];
      handleLaunchPage(lesson.moduleId, firstPage.id || firstPage.pageId);
    } else {
      alert('No pages available for this lesson.');
    }
  };

  return (
    <div className="tcp-container">
      <header className="ts-header" style={{ marginBottom: '24px' }}>
        <div>
          <div className="ts-breadcrumbs">
            My Courses &gt; {courseId} &gt; {activeModule?.title || 'Loading...'}
          </div>
          <h1 style={{ fontSize: '28px', fontWeight: '800', marginTop: '8px' }}>
            Course Preview: {customNames?.courses?.[courseId] || courseId}
          </h1>
        </div>
      </header>

      {/* MODULE OVERVIEW CARD */}
      {activeModule && (
        <section className="module-progress-section">
          <div className="module-progress-details">
            <span className="progress-card-label">Module Overview</span>
            <h3 className="progress-module-title">
              {activeModule.isGraduation ? 'Graduation' : `Module ${activeModule.number}`}: {activeModule.title}
            </h3>
            <p className="progress-module-stats">
              {activeModule.pageCount} pages &bull; Teacher Preview Mode (Unrestricted Access)
            </p>
            
            <div className="progress-status-pill completed">
              <span className="status-pill-icon">🔓</span>
              <span className="status-pill-text">All content unlocked for teachers</span>
            </div>
          </div>
        </section>
      )}

      {/* TIMELINE SECTION */}
      <section className="journey-section">
        <div className="section-header">
          <h3 className="section-title">
            Course Modules Content
          </h3>
        </div>

        <div className="timeline-wrapper">
          <div className="timeline-line">
            {loadingLessons ? (
              <p style={{ paddingLeft: 12, margin: 0 }}>Loading course timeline...</p>
            ) : lessonsData.length > 0 ? (
              lessonsData.map((module, index) => {
                const isCurrent = index === selectedModuleIndex;

                return (
                  <div key={module.id} className="timeline-step">
                    <button
                      type="button"
                      className={`step-node ${isCurrent ? 'active' : 'completed'}`}
                      onClick={() => {
                        setSelectedModuleIndex(index);
                        setSelectedLessonIndex(0);
                      }}
                    >
                      {module.number}
                    </button>
                    <span className={`step-name ${isCurrent ? 'active' : ''}`}>
                      {module.isGraduation ? 'Graduation' : `Module ${module.number}`}
                    </span>
                  </div>
                );
              })
            ) : null}
          </div>
        </div>
      </section>

      {/* TWO COLUMNS GRID */}
      <div className="dashboard-grid">
        {/* COLUMN 1: Dynamic Lesson Selector */}
        {activeModule && (
          <div className="continue-card lesson-selector-card">
            <div className="continue-card-header">
              <span className="card-label">
                {activeModule.isGraduation ? 'Graduation' : `Module ${activeModule.number}`}
              </span>
              <h4 className="card-title">{activeModule.title}</h4>
            </div>

            <div className="lesson-selection-list">
              {activeModule.lessons.map((lesson, index) => {
                const isSelected = index === selectedLessonIndex;
                return (
                  <button
                    key={lesson.key}
                    type="button"
                    className={`lesson-list-btn ${isSelected ? 'active' : ''}`}
                    onClick={() => setSelectedLessonIndex(index)}
                  >
                    {isSelected && <div className="active-indicator" />}
                    <div className="lesson-number-badge">
                      L{lesson.number}
                    </div>
                    <div className="lesson-info-text">
                      <div className="lesson-list-title">{lesson.title}</div>
                      <div className="lesson-list-pages-count">{lesson.pages?.length || 0} pages / activities</div>
                    </div>
                    <span className="lesson-list-arrow">&gt;</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* COLUMN 2: Page Circles Grid */}
        <div className="my-courses-card">
          <div className="section-header">
            <h3 className="section-title">Lesson Pages</h3>
            <span className="pages-count-tag">
              {activeLesson?.pages?.length || 0} pages
            </span>
          </div>

          <div className="pages-circles-grid">
            {activeLesson?.pages && activeLesson.pages.length > 0 ? (
              activeLesson.pages.map((page, index) => {
                const pageNum = index + 1;
                const tasksCount = page.taskCount || 1;

                return (
                  <button
                    key={page.id || page.pageId}
                    type="button"
                    className="page-circle-item"
                    onClick={() => handleLaunchPage(activeLesson.moduleId, page.id || page.pageId)}
                  >
                    <div className="circle-node completed">
                      <span className="circle-label">PAGE</span>
                      <span className="circle-number">{String(pageNum).padStart(2, '0')}</span>
                    </div>
                    <span className="circle-task-count">
                      {tasksCount} {tasksCount === 1 ? 'task' : 'tasks'}
                    </span>
                  </button>
                );
              })
            ) : (
              <p style={{ gridColumn: '1 / -1', color: '#64748b' }}>No pages in this lesson.</p>
            )}
          </div>

          {activeLesson && (
            <div style={{ marginTop: '40px' }}>
              <button
                type="button"
                className="preview-lesson-btn"
                onClick={() => handleLaunchFirstPageOfLesson(activeLesson)}
              >
                Preview Lesson {activeLesson.number}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
