import './index.css';
import './i18n';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';

import { AppProviders } from './app/providers';
import { router } from './app/router';
import { listenForInstallPrompt } from './features/notifications/installPrompt';
import { listenForNotificationNavigation } from './features/notifications/notificationNavigation';

// Both events can arrive before any component mounts.
listenForInstallPrompt();
listenForNotificationNavigation((path) => router.navigate(path));

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
