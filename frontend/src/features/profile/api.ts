import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ME_QUERY_KEY, type Me } from '@/features/auth/api';
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
