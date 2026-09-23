import { Navigate, useSearchParams } from 'react-router';

import { useMe } from '@/features/auth/api';
import { safeNext } from '@/features/auth/next';
import { LandingPage } from '@/features/auth/pages/LandingPage';
import { DashboardPage } from '@/features/events/pages/DashboardPage';

/** `/`: the Landing when signed out, the dashboard when signed in. */
export function HomeRoute() {
  const { data: me } = useMe();
  const [params] = useSearchParams();

  if (!me) return <LandingPage />;

  // Signed in with a pending `next` (e.g. signed in from another tab): finish the trip.
  const next = safeNext(params.get('next'));
  if (next !== '/') return <Navigate to={next} replace />;

  return <DashboardPage />;
}
