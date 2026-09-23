import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { eventKeys, type EventDetail, type UserPublic } from '@/features/events/api';
import { apiClient } from '@/lib/apiClient';

/** Backend `app/schemas/invites.py`. */
export type JoinBlockReason =
  'EVENT_ALREADY_DRAWN' | 'JOIN_DEADLINE_PASSED' | 'ALREADY_PARTICIPANT';

export interface InvitePreview {
  event_name: string;
  host: UserPublic;
  budget_crc: number;
  exchange_at: string;
  participant_count: number;
  already_participant: boolean;
  /** Only when already a participant. */
  event_id: string | null;
  joinable: boolean;
  reason: JoinBlockReason | null;
}

export interface JoinResult {
  event_id: string;
}

export const inviteKeys = {
  preview: (token: string) => ['invites', token] as const,
};

const tokenPath = (token: string) => `/invites/${encodeURIComponent(token)}`;

export function useInvitePreview(token: string) {
  return useQuery({
    queryKey: inviteKeys.preview(token),
    queryFn: ({ signal }) => apiClient.get<InvitePreview>(tokenPath(token), { signal }),
    staleTime: 0,
  });
}

export function useJoinEvent(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post<JoinResult>(`${tokenPath(token)}/join`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: eventKeys.all });
    },
  });
}

/** Host: new token (also re-enables a disabled link). The old link stops working. */
export function useRegenerateInvite(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post<EventDetail>(`/events/${eventId}/invite/regenerate`),
    onSuccess: (event) => {
      queryClient.setQueryData(eventKeys.detail(eventId), event);
    },
  });
}

/** Host: turn the link off (token becomes null). */
export function useDisableInvite(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.delete<EventDetail>(`/events/${eventId}/invite`),
    onSuccess: (event) => {
      queryClient.setQueryData(eventKeys.detail(eventId), event);
    },
  });
}
