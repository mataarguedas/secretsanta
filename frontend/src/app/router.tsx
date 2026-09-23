import { createBrowserRouter, type RouteObject } from 'react-router';

import { HomePage } from './pages/HomePage';

// Dev-only routes. `import.meta.env.DEV` is statically false in production builds, so the
// showcase module is dropped from the bundle entirely.
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: '/__ui',
        lazy: async () => ({ Component: (await import('./dev/UiShowcasePage')).default }),
      },
    ]
  : [];

// TODO(prompt 5): add every route from CLAUDE.md §8, layout shells and ProtectedRoute.
export const router = createBrowserRouter([{ path: '/', element: <HomePage /> }, ...devRoutes]);
