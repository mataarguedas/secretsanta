import { Outlet } from 'react-router';

/**
 * Gate for signed-in routes.
 * TODO(prompt 7): redirect signed-out users to `/?next=<path>` (FR-AUTH-5). Everyone gets
 * in for now.
 */
export function ProtectedRoute() {
  return <Outlet />;
}
