import { installTabIsolatedLmsStorage } from './security/secureLmsHandoffReceiver.js';
installTabIsolatedLmsStorage();

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { installSecureLmsHandoffReceiver } from './lib/secureLmsHandoff.js';
import { installScheduleAuthFetch } from './lib/scheduleAuthFetch.js';
import { installBackendAuthFetch } from './lib/backendAuthFetch.js';
import { installRoleAuthFailureGuard } from './lib/roleAuthFailureGuard.js';
import { installAnswerKeyCompatFetch } from './lib/answerKeyCompatFetch.js';
import { installPlatformTicketWidget } from './lib/platformTicketWidget.js';
import './styles.css';

installSecureLmsHandoffReceiver();
installScheduleAuthFetch();
installBackendAuthFetch();
installRoleAuthFailureGuard();
installAnswerKeyCompatFetch();
installPlatformTicketWidget();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
