const CAPTURE_CROP = {
  left: 90,
  right: 90,
  top: 60,
  bottom: 170,
};

function getHotspotStyle(target, viewport) {
  if (!target?.rect || !viewport?.width || !viewport?.height) return null;

  const { x, y, w, h } = target.rect;
  const visibleWidth = Math.max(1, viewport.width - CAPTURE_CROP.left - CAPTURE_CROP.right);
  const visibleHeight = Math.max(1, viewport.height - CAPTURE_CROP.top - CAPTURE_CROP.bottom);

  const left = ((x - CAPTURE_CROP.left) / visibleWidth) * 100;
  const top = ((y - CAPTURE_CROP.top) / visibleHeight) * 100;
  const width = (w / visibleWidth) * 100;
  const height = (h / visibleHeight) * 100;

  if (left > 100 || top > 100 || left + width < 0 || top + height < 0) return null;

  return {
    left: `${Math.max(0, left)}%`,
    top: `${Math.max(0, top)}%`,
    width: `${Math.min(100, width)}%`,
    height: `${Math.min(100, height)}%`,
  };
}

function isDynamicReplayTask(task) {
  const type = String(task?.activityType || '').toLowerCase();

  return (
    type === 'code_typing_task' ||
    type === 'matching_dragdrop_task'
  );
}

export default function StateReplay({
  task,
  state,
  stateIndex,
  rawMode,
  onNext,
  onPrev,
  onSelectState,
}) {
  const safeState = state || task?.states?.[stateIndex] || task?.states?.[0] || {};
  const viewport = safeState.viewport || { width: 1920, height: 989 };
  const target = safeState.triggeredBy || safeState.clickAudit?.[0] || null;
  const hotspotStyle = getHotspotStyle(target, viewport);

  const dynamicReplay = isDynamicReplayTask(task);

  const shouldShowFullScreenshot = rawMode || dynamicReplay;

  const cardStyle = shouldShowFullScreenshot
    ? {
      width: 'min(1728px, 100%)',
      height: 'calc(100vh - var(--top-nav-height) - 96px)',
      maxHeight: 'none',
      aspectRatio: 'auto',
      position: 'relative',
      overflow: 'hidden',
      borderRadius: '2px',
      background: '#ffffff',
    }
    : undefined;

  const imageStyle = shouldShowFullScreenshot
    ? {
      position: 'static',
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      userSelect: 'none',
      pointerEvents: 'none',
    }
    : undefined;

  if (!safeState.screenshot) {
    return (
      <main className={`activity-screen ${rawMode ? 'raw-mode' : ''}`}>
        <section className="activity-stage">
          <div className="functional-card">
            <h1>{task?.title || task?.activityType || 'Activity'}</h1>
            <p>No screenshot was found for this state.</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`activity-screen ${rawMode ? 'raw-mode' : ''} ${dynamicReplay ? 'dynamic-replay-mode' : ''}`}>
      {!rawMode && (
        <button type="button" className="side-arrow left" onClick={onPrev} aria-label="Previous state">
          ‹
        </button>
      )}

      <section className="activity-stage" aria-label={task.title || task.activityType}>
        <div className="capture-card" style={cardStyle}>
          <img
            className="capture-image"
            src={safeState.screenshot}
            alt={`${task.title || task.activityType} - ${safeState.name || `State ${stateIndex + 1}`}`}
            draggable="false"
            style={imageStyle}
          />

          {!shouldShowFullScreenshot && hotspotStyle && (
            <button
              type="button"
              className="hotspot"
              style={hotspotStyle}
              onClick={onNext}
              title={target?.text || target?.ariaLabel || 'Captured click target'}
            />
          )}
        </div>
      </section>

      {!rawMode && (
        <button type="button" className="side-arrow right" onClick={onNext} aria-label="Next state">
          ›
        </button>
      )}

      {!rawMode && (
        <div className="bottom-controls">
          <div className="page-indicators">
            {(task.states || []).map((item, index) => (
              <button
                key={item.id || index}
                type="button"
                className={`mini-dot ${index === stateIndex ? 'active' : ''}`}
                onClick={() => onSelectState(index)}
                aria-label={`State ${index + 1}`}
              />
            ))}
          </div>
          <button type="button" className="next-button" onClick={onNext}>Next</button>
        </div>
      )}
    </main>
  );
}