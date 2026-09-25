import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useNavigate } from 'react-router';

import { chatKeys } from '@/features/chat/api';
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
  /** Presigned (1 h) URLs, or null without a cover. Cards use the thumbnail. */
  cover_url: string | null;
  cover_thumb_url: string | null;
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
  /** null: an archived event whose host deleted their account ("Deleted user"). */
  host: UserPublic | null;
  participant_count: number;
  /** Presigned (1 h) URLs, or null without a cover. */
  cover_url: string | null;
  cover_thumb_url: string | null;
  my_role: 'host' | 'participant';
  /** The caller's own receiver once drawn; never anyone else's (CLAUDE.md §2.1). */
  my_assignment: MyAssignment | null;
  /** Present only in the host's view; null when the link is disabled. */
  invite_token?: string | null;
  /** Present only in the host's view. */
  draw_readiness?: DrawReadiness;
}

/** FR-DRW-4: who the signed-in giver gives to. */
export interface MyAssignment {
  receiver: { user_id: string; name: string; avatar_url: string | null };
}

/** Host only: whether the reveal can run (≥ 3 people, OPEN, a valid draw exists). */
export interface DrawReadiness {
  participant_count: number;
  feasible: boolean;
  can_draw: boolean;
}

/** A roster row (`GET /events/{id}/participants`). Never an email. */
export interface Participant {
  user_id: string;
  name: string;
  avatar_url: string | null;
  is_host: boolean;
  is_self: boolean;
  joined_at: string;
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

/** `PATCH /events/{id}` body: only the fields that changed. */
export type EventUpdatePayload = Partial<EventCreatePayload>;

export const eventKeys = {
  all: ['events'] as const,
  section: (section: EventSection) => ['events', { section }] as const,
  detail: (id: string) => ['events', id] as const,
  participants: (id: string) => ['events', id, 'participants'] as const,
  exclusions: (id: string) => ['events', id, 'exclusions'] as const,
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

export function useUpdateEvent(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: EventUpdatePayload) =>
      apiClient.patch<EventDetail>(`/events/${id}`, payload),
    onSuccess: async (event) => {
      queryClient.setQueryData(eventKeys.detail(id), event);
      // Dashboard cards show name, date and budget.
      await queryClient.invalidateQueries({
        queryKey: eventKeys.all,
        predicate: (query) => query.queryKey[1] !== id,
      });
    },
  });
}

/**
 * `DELETE /events/{id}`, then go to the dashboard. Navigating first means the event page
 * is gone before its query is dropped, so it never refetches into a 404.
 */
export function useDeleteEvent(id: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => apiClient.delete<undefined>(`/events/${id}`),
    onSuccess: async () => {
      await navigate('/', { replace: true });
      queryClient.removeQueries({ queryKey: eventKeys.detail(id), exact: true });
      await queryClient.invalidateQueries({ queryKey: eventKeys.all });
    },
  });
}

/**
 * Host archives a DRAWN event after its exchange (PRD §3). Everything in it turns
 * read-only, it moves to Past, and its chats (which carry the event state) close.
 */
export function useArchiveEvent(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post<EventDetail>(`/events/${id}/archive`),
    onSuccess: async (event) => {
      queryClient.setQueryData(eventKeys.detail(id), event);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventKeys.all }),
        queryClient.invalidateQueries({ queryKey: chatKeys.all }),
      ]);
    },
  });
}

export function useParticipants(eventId: string) {
  return useQuery({
    queryKey: eventKeys.participants(eventId),
    queryFn: ({ signal }) =>
      apiClient.get<Participant[]>(`/events/${eventId}/participants`, { signal }),
  });
}

/** Host removes someone (OPEN only). Refreshes the roster, the header count and the cards. */
export function useRemoveParticipant(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiClient.delete<undefined>(`/events/${eventId}/participants/${userId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: eventKeys.all });
    },
  });
}

/** Leave (OPEN, not the host), then go to the dashboard before dropping the event's cache. */
export function useLeaveEvent(eventId: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => apiClient.post<undefined>(`/events/${eventId}/leave`),
    onSuccess: async () => {
      await navigate('/', { replace: true });
      queryClient.removeQueries({ queryKey: eventKeys.detail(eventId) });
      await queryClient.invalidateQueries({ queryKey: eventKeys.all });
    },
  });
}

/** Accepted by `POST /events/{id}/cover`; the server sniffs the real format anyway. */
export const COVER_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
/** Mirrors the backend limit (CLAUDE.md §7 Uploads). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface CoverUpload {
  eventId: string;
  file: File;
  onProgress?: (fraction: number) => void;
}

/**
 * Host, OPEN only: set or replace the cover. The old photo is deleted by the worker. The
 * event id travels with each call, so the create page can upload to an event it has only
 * just created.
 */
export function useUploadCover() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, file, onProgress }: CoverUpload) => {
      const form = new FormData();
      form.append('file', file);
      return apiClient.upload<EventDetail>(`/events/${eventId}/cover`, form, {
        ...(onProgress ? { onProgress } : {}),
      });
    },
    onSuccess: (event, { eventId }) => refreshCover(queryClient, eventId, event),
  });
}

export function useRemoveCover(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.delete<EventDetail>(`/events/${eventId}/cover`),
    onSuccess: (event) => refreshCover(queryClient, eventId, event),
  });
}

async function refreshCover(
  queryClient: ReturnType<typeof useQueryClient>,
  eventId: string,
  event: EventDetail,
) {
  queryClient.setQueryData(eventKeys.detail(eventId), event);
  // Dashboard cards show the thumbnail.
  await queryClient.invalidateQueries({
    queryKey: eventKeys.all,
    predicate: (query) => query.queryKey[1] !== eventId,
  });
}
