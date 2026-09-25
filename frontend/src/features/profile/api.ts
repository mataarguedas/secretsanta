import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { clearSession, ME_QUERY_KEY, type Me } from '@/features/auth/api';
import { apiClient } from '@/lib/apiClient';

/** `PATCH /me` fields (backend `MeUpdate`). */
export type MeUpdate = Partial<
  Pick<Me, 'locale' | 'notify_message' | 'notify_wishlist' | 'notify_reminder'>
>;

/**
 * `PATCH /me` with an optimistic update of `['me']`. On failure the previous profile is
 * restored (and, through `useSyncLocale`, the previous language).
 */
export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    // Serial: rapid toggles apply in click order, so a late response can't undo a newer choice.
    scope: { id: 'me' },
    mutationFn: (patch: MeUpdate) => apiClient.patch<Me>('/me', patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: ME_QUERY_KEY });
      const previous = queryClient.getQueryData<Me | null>(ME_QUERY_KEY);
      if (previous) queryClient.setQueryData<Me>(ME_QUERY_KEY, { ...previous, ...patch });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(ME_QUERY_KEY, context.previous);
    },
    onSuccess: (me) => {
      queryClient.setQueryData(ME_QUERY_KEY, me);
    },
  });
}

/** `GET /me/deletion-preview` (backend `DeletionPreviewOut`). */
export interface DeletionPreview {
  /** In a DRAWN event: deletion is refused until those events are archived. */
  blocked: boolean;
  blocking_events: { id: string; name: string }[];
  /** OPEN events the user hosts: deleted together with the account. */
  hosted_open_events: { id: string; name: string; participant_count: number }[];
}

// Not under ['me']: that key survives sign-out (`clearSession`) and patches optimistically.
export const deletionPreviewKey = ['account', 'deletion-preview'] as const;

/** Loaded only while the delete dialog is open, and fresh every time it opens. */
export function useDeletionPreview(enabled: boolean) {
  return useQuery({
    queryKey: deletionPreviewKey,
    queryFn: ({ signal }) => apiClient.get<DeletionPreview>('/me/deletion-preview', { signal }),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * `DELETE /me` (FR-ACC-3). The server clears the cookies; here every cached response goes
 * and the app returns to the Landing page, signed out.
 */
export function useDeleteAccount() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => apiClient.delete<undefined>('/me'),
    onSuccess: async () => {
      clearSession(queryClient);
      await navigate('/', { replace: true });
    },
  });
}
