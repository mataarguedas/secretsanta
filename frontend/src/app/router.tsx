import { createBrowserRouter } from 'react-router';

import { HomePage } from './pages/HomePage';

// TODO(prompt 5): add every route from CLAUDE.md §8, layout shells and ProtectedRoute.
export const router = createBrowserRouter([{ path: '/', element: <HomePage /> }]);
