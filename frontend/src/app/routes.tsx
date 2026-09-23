import type { RouteObject } from 'react-router';

import { AppLayout } from './layout/AppLayout';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { ProtectedRoute } from './ProtectedRoute';

// Dev-only routes. `import.meta.env.DEV` is statically false in production builds, so the
// showcase module is dropped from the bundle entirely.
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: '__ui',
        lazy: async () => ({ Component: (await import('./dev/UiShowcasePage')).default }),
      },
    ]
  : [];

/** Every route from CLAUDE.md §8. Placeholders are replaced feature by feature. */
export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      // TODO(prompt 7): landing when signed out, dashboard when signed in.
      { index: true, element: <HomePage /> },
      { path: 'privacy', element: <PlaceholderPage titleKey="legal.privacy.title" /> },
      { path: 'terms', element: <PlaceholderPage titleKey="legal.terms.title" /> },
      {
        element: <ProtectedRoute />,
        children: [
          { path: 'events/new', element: <PlaceholderPage titleKey="events.create.title" /> },
          {
            path: 'events/:id/:tab?',
            element: <PlaceholderPage titleKey="events.detail.title" />,
          },
          { path: 'join/:token', element: <PlaceholderPage titleKey="invites.join.title" /> },
          { path: 'chats', element: <PlaceholderPage titleKey="chat.list.title" /> },
          {
            path: 'chats/:conversationId',
            element: <PlaceholderPage titleKey="chat.thread.title" />,
          },
          { path: 'profile', element: <PlaceholderPage titleKey="profile.title" /> },
        ],
      },
      ...devRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
