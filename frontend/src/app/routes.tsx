import type { RouteObject } from 'react-router';

import { ChatsPage } from '@/features/chat/pages/ChatsPage';
import { ThreadPage } from '@/features/chat/pages/ThreadPage';
import { CreateEventPage } from '@/features/events/pages/CreateEventPage';
import { EventPage } from '@/features/events/pages/EventPage';
import { JoinPage } from '@/features/invites/pages/JoinPage';
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
          { path: 'events/new', element: <CreateEventPage /> },
          { path: 'events/:id/:tab?', element: <EventPage /> },
          // Signed out: the landing with `next=/join/<token>`, and sign-in returns here (FR-AUTH-5).
          { path: 'join/:token', element: <JoinPage /> },
          { path: 'chats', element: <ChatsPage /> },
          { path: 'chats/:conversationId', element: <ThreadPage /> },
          { path: 'profile', element: <ProfilePage /> },
        ],
      },
      ...devRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
