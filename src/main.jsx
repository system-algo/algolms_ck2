import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { installSecureLmsHandoffReceiver } from './lib/secureLmsHandoff.js';
import { installBackendAuthFetch } from './lib/backendAuthFetch.js';
import { installAnswerKeyCompatFetch } from './lib/answerKeyCompatFetch.js';
import { installPlatformTicketWidget } from './lib/platformTicketWidget.js';
import './styles.css';

installSecureLmsHandoffReceiver();
installBackendAuthFetch();
installAnswerKeyCompatFetch();
installPlatformTicketWidget();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
