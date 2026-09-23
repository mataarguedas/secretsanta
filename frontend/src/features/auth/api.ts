import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import type { Language } from '@/i18n';
import { ApiError, apiClient, type ApiClient } from '@/lib/apiClient';

/** `GET /me` (backend `MeResponse`). Only ever the signed-in user's own profile. */
export interface Me {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  locale: Language;
  notify_message: boolean;
  notify_wishlist: boolean;
  notify_reminder: boolean;
}

export const ME_QUERY_KEY = ['me'] as const;

/**
 * The session. `null` means signed out: a 401 (after the client's refresh attempt) is an
 * expected state, not an error, so it never reaches error UI.
 */
export async function fetchMe(signal?: AbortSignal): Promise<Me | null> {
  try {
    return await apiClient.get<Me>('/me', signal ? { signal } : {});
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: ({ signal }) => fetchMe(signal),
    staleTime: 5 * 60_000,
  });
}

/** Signed-out marker: keep `['me']` as `null` and drop every other cached server response. */
export function clearSession(queryClient: QueryClient): void {
  queryClient.setQueryData<Me | null>(ME_QUERY_KEY, null);
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_QUERY_KEY[0] });
}

/**
 * When the client gives up on a session (refresh failed), mark the user signed out; the
 * protected route then redirects to `/?next=…`. Returns the unbind function.
 */
export function bindSessionToQueryClient(client: ApiClient, queryClient: QueryClient): () => void {
  client.setOnUnauthenticated(() => {
    queryClient.setQueryData<Me | null>(ME_QUERY_KEY, null);
  });
  return () => {
    client.setOnUnauthenticated(undefined);
  };
}

/** `POST /auth/logout`, then clear the cache and go to `/`. */
export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => apiClient.post<undefined>('/auth/logout'),
    onSuccess: () => {
      clearSession(queryClient);
      void navigate('/', { replace: true });
    },
  });
}
