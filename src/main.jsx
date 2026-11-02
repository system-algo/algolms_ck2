import React from 'react';
import { createRoot } from 'react-dom/client';
import { installSecureLmsHandoffReceiver } from './lib/secureLmsHandoff.js';
import { installBackendAuthFetch } from './lib/backendAuthFetch.js';
import { installAnswerKeyCompatFetch } from './lib/answerKeyCompatFetch.js';
import { installPlatformTicketWidget } from './lib/platformTicketWidget.js';
import './styles.css';

installSecureLmsHandoffReceiver();
installBackendAuthFetch();
installAnswerKeyCompatFetch();
installPlatformTicketWidget();


function hasVerifiedLmsContext() {
  try {
    const email = String(localStorage.getItem('lms_student_email') || localStorage.getItem('lms_user_email') || '').trim().toLowerCase();
    const courseId = String(localStorage.getItem('lms_course_id') || '').trim();
    const token = String(localStorage.getItem('lms_access_token') || '').trim();
    const payload = token.split('.')[1];
    if (!email || email === 'guest@algo.edu.vn' || !courseId || !payload) return false;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
    if (String(decoded.email || '').trim().toLowerCase() !== email) return false;
    return !decoded.exp || Number(decoded.exp) * 1000 > Date.now();
  } catch {
    return false;
  }
}

async function waitForPortalHandoff() {
  if (!window.opener) return true; // Preserve direct-link behavior.
  if (window.__algoSecureLmsHandoffPending) {
    await new Promise((resolve) => {
      const deadline = Date.now() + 13000;
      const check = () => {
        if (!window.__algoSecureLmsHandoffPending || Date.now() >= deadline) {
          resolve();
        } else {
          window.setTimeout(check, 75);
        }
      };
      check();
    });
  }
  // Portal handoffs must fail closed, never silently mount as Guest.
  return hasVerifiedLmsContext();
}

async function mountVerifiedLms() {
  const root = createRoot(document.getElementById('root'));
  if (window.opener) {
    root.render(<div role="status">Connecting to your learning session...</div>);
  }
  const verified = await waitForPortalHandoff();
  if (!verified) {
    root.render(
      <div role="alert">
        Could not verify your learning session. Close this tab and reopen the course from the learning platform.
      </div>,
    );
    return;
  }
  // Import App only after the receiver installs tab-scoped storage and
  // finishes the secure handoff. Module-level initialization is now safe.
  const { default: App } = await import('./App.jsx');
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
void mountVerifiedLms();
