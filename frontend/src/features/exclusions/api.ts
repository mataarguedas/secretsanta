import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { eventKeys, type UserPublic } from '@/features/events/api';
import { apiClient } from '@/lib/apiClient';

/** Backend `app/schemas/exclusions.py`. Host only (FR-EXC-5). */
export interface Exclusion {
  id: string;
  /** Canonical order (`user_a.id < user_b.id`); the pair is symmetric. */
  user_a: UserPublic;
  user_b: UserPublic;
}

export interface ExclusionList {
  items: Exclusion[];
  /** Whether a valid draw exists with the current roster and exclusions (FR-EXC-4). */
  feasible: boolean;
}

export function useExclusions(eventId: string) {
  return useQuery({
    queryKey: eventKeys.exclusions(eventId),
    queryFn: ({ signal }) =>
      apiClient.get<ExclusionList>(`/events/${eventId}/exclusions`, { signal }),
  });
}

/** Every response is the whole list; the event detail carries `draw_readiness`, so refresh it. */
async function applyList(queryClient: QueryClient, eventId: string, list: ExclusionList) {
  queryClient.setQueryData(eventKeys.exclusions(eventId), list);
  await queryClient.invalidateQueries({ queryKey: eventKeys.detail(eventId), exact: true });
}

/** Two ids create a pair; three or more are the group helper (all pairs). Idempotent. */
export function useCreateExclusions(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) =>
      apiClient.post<ExclusionList>(`/events/${eventId}/exclusions`, { user_ids: userIds }),
    onSuccess: (list) => applyList(queryClient, eventId, list),
  });
}

export function useDeleteExclusion(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (exclusionId: string) =>
      apiClient.delete<ExclusionList>(`/events/${eventId}/exclusions/${exclusionId}`),
    onSuccess: (list) => applyList(queryClient, eventId, list),
  });
}
