import { Navigate, Outlet, useLocation } from 'react-router';

import { useMe } from '@/features/auth/api';
import { signInRedirect } from '@/features/auth/next';

/**
 * Gate for signed-in routes: signed-out visitors go to `/?next=<path+search>` (FR-AUTH-5).
 * `AppLayout` resolves the session before rendering any route, so `data` is settled here.
 */
export function ProtectedRoute() {
  const { data: me } = useMe();
  const { pathname, search } = useLocation();

  if (!me) return <Navigate to={signInRedirect(pathname, search)} replace />;
  return <Outlet />;
}
