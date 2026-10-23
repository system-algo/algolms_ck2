import './lms-activity-frame.css';

function getPtsyBannerDetails(statusText) {
  if (!statusText) return null;
  const s = String(statusText).trim();
  const lower = s.toLowerCase();

  // When no answer is chosen before checking
  if (
    lower.includes('choose an answer') ||
    lower.includes('pick an answer') ||
    lower.includes('select an answer') ||
    lower.includes('chưa chọn') ||
    lower.includes('chọn đáp án') ||
    lower.includes('choose your answer') ||
    lower.includes('enter a link') ||
    lower.includes('submit the answer') ||
    lower.includes('submit answer') ||
    lower.includes('please place all') ||
    lower.includes('please complete all')
  ) {
    const desc = lower.includes('enter a link')
      ? '✕ Please enter a link first.'
      : lower.includes('submit the answer') || lower.includes('submit answer')
      ? '✕ Please submit the answer first.'
      : lower.includes('please place all') || lower.includes('please complete all')
      ? (s.startsWith('✕') ? s : `✕ ${s}`)
      : '✕ Please choose an answer before checking.';
    return {
      type: 'error',
      isSuccess: false,
      title: 'Almost there! 🌟',
      description: desc,
    };
  }

  if (lower === 'checking' || lower === 'checking...' || lower.startsWith('checking')) {
    return {
      type: 'checking',
      title: 'Let’s see... 👀',
      description: 'Checking your answer...',
    };
  }

  const isSuccess =
    lower.includes('correct') ||
    lower.includes('đúng') ||
    lower.includes('completed') ||
    lower.includes('hoàn thành') ||
    lower.includes('great job') ||
    lower.includes('you got it') ||
    lower.includes('saved') ||
    lower.includes('viewed');

  if (isSuccess) {
    const desc =
      s === 'Correct.' || s === 'Correct!' || s === 'You got it!' || s.includes('got it') || lower.includes('completed')
        ? 'You got it!'
        : s;
    return {
      type: 'success',
      isSuccess: true,
      title: 'Great job! 🎉',
      description: desc.startsWith('✓') ? desc : `✓ ${desc}`,
    };
  }

  const desc = 'Try again';

  return {
    type: 'error',
    isSuccess: false,
    title: 'Almost there! 🌟',
    description: `✕ ${desc}`,
  };
}

export default function LmsActivityFrame({
  children,
  title,
  status,
  onNextTask,
  onPrevTask,
  nextLabel = 'Next',
  
  footer,
  className = '',
  innerClassName = '',

  // When true, the task was previously completed.
  isTaskDone = false,
  
  // Floating Action Props
  onCheck,
  onReset,
  isCheckDisabled,
  isResetDisabled,
  isCheckLoading,
}) {
  const hasCheck = typeof onCheck === 'function';
  const banner = getPtsyBannerDetails(status);

  const handleCheck = (e) => {
    if (!hasCheck) return;

    try {
      onCheck(e);
    } catch (err) {
      console.error('[LMS_CHECK_ERROR]', err);
    }
  };

  return (
    <main className={`lms-frame ${className}`}>
      <div className={`lms-frame__inner ${innerClassName}`}>
        <section
          className="lms-frame__card"
          aria-label={title || 'Activity'}
        >
          <div className="lms-frame__content">
            {children}

            {banner && (
              <div
                className={`ptsy-feedback-banner ${
                  banner.type === 'checking'
                    ? 'ptsy-banner--checking'
                    : banner.type === 'success' || banner.isSuccess
                    ? 'ptsy-banner--success'
                    : 'ptsy-banner--error'
                }`}
              >
                <div className="ptsy-banner__icon-wrap">
                  {banner.type === 'checking' ? (
                    <svg
                      className="ptsy-banner__icon"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <circle cx="5" cy="12" r="2.2" />
                      <circle cx="12" cy="12" r="2.2" />
                      <circle cx="19" cy="12" r="2.2" />
                    </svg>
                  ) : banner.type === 'success' || banner.isSuccess ? (
                    <svg
                      className="ptsy-banner__icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg
                      className="ptsy-banner__icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                      <polyline points="3 3 3 8 8 8" />
                    </svg>
                  )}
                </div>
                <div className="ptsy-banner__text-wrap">
                  <div className="ptsy-banner__title">{banner.title}</div>
                  <div className="ptsy-banner__desc">{banner.description}</div>
                </div>
              </div>
            )}

            {footer && <div className="lms-frame__footer">{footer}</div>}
          </div>
          
          {/* Floating Action Buttons */}
          {(hasCheck || onReset) && (
            <div className="lms-frame__floating-actions">
              {hasCheck && (
                <button
                  type="button"
                  className="lms-fab lms-fab--check"
                  onClick={handleCheck}
                  disabled={isCheckDisabled || isCheckLoading}
                  title="Check answer"
                >
                  {isCheckLoading ? (
                    <span className="lms-fab-spinner" />
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              )}
              {onReset && (
                <button
                  type="button"
                  className="lms-fab lms-fab--reset"
                  onClick={onReset}
                  disabled={isResetDisabled}
                  title="Reset"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <polyline points="3 3 3 8 8 8" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}