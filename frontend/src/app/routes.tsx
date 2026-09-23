import type { RouteObject } from 'react-router';

import { ProfilePage } from '@/features/profile/pages/ProfilePage';

import { AppLayout } from './layout/AppLayout';
import { HomeRoute } from './pages/HomeRoute';
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
      // Public: the landing (or dashboard when signed in), legal pages, 404, dev showcase.
      { index: true, element: <HomeRoute /> },
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
          // TODO(prompt 12): the join screen gets its own sign-in step; until then it
          // redirects to `/?next=` like every other protected route.
          { path: 'join/:token', element: <PlaceholderPage titleKey="invites.join.title" /> },
          { path: 'chats', element: <PlaceholderPage titleKey="chat.list.title" /> },
          {
            path: 'chats/:conversationId',
            element: <PlaceholderPage titleKey="chat.thread.title" />,
          },
          { path: 'profile', element: <ProfilePage /> },
        ],
      },
      ...devRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
