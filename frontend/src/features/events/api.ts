import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/apiClient';

/** Backend `app/schemas/events.py`. */
export type EventState = 'open' | 'drawn' | 'archived';
export type EventSection = 'hosting' | 'participating' | 'past';

export interface EventSummary {
  id: string;
  name: string;
  state: EventState;
  participant_count: number;
  exchange_at: string;
  budget_crc: number;
  is_host: boolean;
}

export interface EventPage {
  items: EventSummary[];
  next_cursor: string | null;
}

export interface UserPublic {
  id: string;
  name: string;
  avatar_url: string | null;
}

export interface EventDetail {
  id: string;
  name: string;
  description: string | null;
  budget_crc: number;
  exchange_at: string;
  join_deadline: string | null;
  location: string | null;
  is_online: boolean;
  group_chat_enabled: boolean;
  state: EventState;
  drawn_at: string | null;
  archived_at: string | null;
  host: UserPublic;
  participant_count: number;
  my_role: 'host' | 'participant';
  my_assignment: null; // TODO(prompt 16): the caller's own receiver after the draw.
  /** Present only in the host's view; null when the link is disabled. */
  invite_token?: string | null;
}

/** `POST /events` body. */
export interface EventCreatePayload {
  name: string;
  description: string | null;
  budget_crc: number;
  exchange_at: string;
  join_deadline: string | null;
  location: string | null;
  is_online: boolean;
  group_chat_enabled: boolean;
}

export const eventKeys = {
  all: ['events'] as const,
  section: (section: EventSection) => ['events', { section }] as const,
  detail: (id: string) => ['events', id] as const,
};

export function useEvents(section: EventSection) {
  return useInfiniteQuery({
    queryKey: eventKeys.section(section),
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ section });
      if (pageParam) params.set('cursor', pageParam);
      return apiClient.get<EventPage>(`/events?${params.toString()}`, { signal });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
}

export function useEvent(id: string) {
  return useQuery({
    queryKey: eventKeys.detail(id),
    queryFn: ({ signal }) => apiClient.get<EventDetail>(`/events/${id}`, { signal }),
  });
}

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: EventCreatePayload) => apiClient.post<EventDetail>('/events', payload),
    onSuccess: async (event) => {
      queryClient.setQueryData(eventKeys.detail(event.id), event);
      await queryClient.invalidateQueries({ queryKey: eventKeys.all, exact: false });
    },
  });
}
