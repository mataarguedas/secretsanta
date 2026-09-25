import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';

import type { EventState } from '@/features/events/api';
import { apiClient } from '@/lib/apiClient';

/**
 * Backend `app/schemas/chat.py`. A member never carries a user id; an anonymous member is
 * only its alias (`anon_number`) with no avatar, for every viewer (CLAUDE.md §2.2).
 */
export interface MemberPublic {
  id: string;
  display_name: string;
  avatar_url: string | null;
  is_self: boolean;
  is_anonymous: boolean;
  anon_number: number | null;
  is_former: boolean;
  /** Deleted their account: "Deleted user". Never true for an anonymous member. */
  is_deleted: boolean;
}

export interface MessagePublic {
  id: string;
  conversation_id: string;
  sender_member_id: string;
  body: string | null;
  deleted: boolean;
  created_at: string;
}

export type ConversationKind = 'direct' | 'anonymous' | 'group';

export interface ConversationSummary {
  id: string;
  event: { id: string; name: string; state: EventState };
  kind: ConversationKind;
  title_member: MemberPublic | null;
  my_member: MemberPublic;
  last_message: MessagePublic | null;
  last_message_at: string | null;
  unread_count: number;
}

export interface ConversationDetail extends ConversationSummary {
  members: MemberPublic[];
}

export interface ConversationPage {
  items: ConversationSummary[];
  next_cursor: string | null;
}

export interface MessagePage {
  items: MessagePublic[]; // newest first
  next_cursor: string | null;
}

export const MESSAGE_MAX = 2000;

export const chatKeys = {
  all: ['conversations'] as const,
  /** `eventId` undefined = every conversation (the Chats tab). */
  list: (eventId?: string) => ['conversations', { eventId: eventId ?? null }] as const,
  detail: (id: string) => ['conversations', 'detail', id] as const,
  messages: (id: string) => ['conversations', 'messages', id] as const,
};

type ListData = InfiniteData<ConversationPage, string | null>;
type MessagesData = InfiniteData<MessagePage, string | null>;

// ── Queries ─────────────────────────────────────────────────────────────────

export function useConversations(eventId?: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: chatKeys.list(eventId),
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      if (eventId) params.set('event_id', eventId);
      if (pageParam) params.set('cursor', pageParam);
      const query = params.toString();
      return apiClient.get<ConversationPage>(`/conversations${query ? `?${query}` : ''}`, {
        signal,
      });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled,
  });
}

export function useConversation(id: string) {
  return useQuery({
    queryKey: chatKeys.detail(id),
    queryFn: ({ signal }) => apiClient.get<ConversationDetail>(`/conversations/${id}`, { signal }),
  });
}

export function useMessages(id: string) {
  return useInfiniteQuery({
    queryKey: chatKeys.messages(id),
    queryFn: ({ pageParam, signal }) =>
      apiClient.get<MessagePage>(
        `/conversations/${id}/messages${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
}

/** Sum over every loaded list page of the Chats tab (the nav badge). */
export function useUnreadTotal(enabled: boolean): number {
  const query = useConversations(undefined, enabled);
  return (query.data?.pages ?? []).reduce(
    (sum, page) => sum + page.items.reduce((n, c) => n + c.unread_count, 0),
    0,
  );
}

// ── Mutations ───────────────────────────────────────────────────────────────

export function useStartConversation(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { kind: 'direct' | 'anonymous'; recipient_id: string }) =>
      apiClient.post<ConversationDetail>(`/events/${eventId}/conversations`, payload),
    onSuccess: (detail) => {
      queryClient.setQueryData(chatKeys.detail(detail.id), detail);
      void invalidateConversationLists(queryClient);
    },
  });
}

export function useDeleteMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (message: MessagePublic) => apiClient.delete<undefined>(`/messages/${message.id}`),
    onSuccess: (_data, message) => {
      markDeleted(queryClient, message.conversation_id, message.id);
    },
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      apiClient.post<undefined>(`/conversations/${conversationId}/read`),
    onMutate: (conversationId) => {
      updateConversation(queryClient, conversationId, (c) => ({ ...c, unread_count: 0 }));
    },
  });
}

/** REST fallback when the socket is down (same rules server-side). */
export function sendMessageRest(conversationId: string, body: string, clientId: string) {
  return apiClient.post<MessagePublic>(`/conversations/${conversationId}/messages`, {
    body,
    client_id: clientId,
  });
}

// ── Cache updates (also driven by WebSocket frames) ─────────────────────────

/** Every conversation list (all, and per event), not threads. */
export function invalidateConversationLists(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    queryKey: chatKeys.all,
    predicate: (query) => typeof query.queryKey[1] === 'object',
  });
}

function eachList(queryClient: QueryClient, update: (data: ListData) => ListData): void {
  queryClient.setQueriesData<ListData>(
    {
      queryKey: chatKeys.all,
      predicate: (query) => {
        const second = query.queryKey[1];
        return typeof second === 'object' && second !== null;
      },
    },
    (data) => (data ? update(data) : data),
  );
}

function listHas(queryClient: QueryClient, conversationId: string): boolean {
  return queryClient
    .getQueriesData<ListData>({ queryKey: chatKeys.all })
    .some(
      ([key, data]) =>
        typeof key[1] === 'object' &&
        data?.pages.some((page) => page.items.some((c) => c.id === conversationId)) === true,
    );
}

export function updateConversation(
  queryClient: QueryClient,
  conversationId: string,
  update: (c: ConversationSummary) => ConversationSummary,
): void {
  eachList(queryClient, (data) => ({
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((c) => (c.id === conversationId ? update(c) : c)),
    })),
  }));
  queryClient.setQueryData<ConversationDetail>(chatKeys.detail(conversationId), (detail) =>
    detail ? { ...detail, ...update(detail) } : detail,
  );
}

/** Newest first, like the API: move the conversation to the top of its list. */
function bumpToTop(data: ListData, conversationId: string): ListData {
  let moved: ConversationSummary | undefined;
  const pages = data.pages.map((page) => ({
    ...page,
    items: page.items.filter((c) => {
      if (c.id === conversationId) moved = c;
      return c.id !== conversationId;
    }),
  }));
  const [first, ...rest] = pages;
  if (!moved || !first) return data;
  return { ...data, pages: [{ ...first, items: [moved, ...first.items] }, ...rest] };
}

/**
 * A message arrived (socket frame, REST reply or reconciled ack): add it to the thread,
 * update the list preview, and count it unread unless it's mine or the thread is on
 * screen. Returns false if the conversation isn't in any loaded list (a new thread).
 */
export function applyIncomingMessage(
  queryClient: QueryClient,
  message: MessagePublic,
  { viewing }: { viewing: boolean },
): boolean {
  queryClient.setQueryData<MessagesData>(chatKeys.messages(message.conversation_id), (data) => {
    const first = data?.pages[0];
    if (!data || !first) return data;
    const exists = data.pages.some((page) => page.items.some((m) => m.id === message.id));
    if (exists) {
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.map((m) => (m.id === message.id ? message : m)),
        })),
      };
    }
    return {
      ...data,
      pages: [{ ...first, items: [message, ...first.items] }, ...data.pages.slice(1)],
    };
  });

  const known = listHas(queryClient, message.conversation_id);
  eachList(queryClient, (data) => {
    const updated: ListData = {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.map((c) => {
          if (c.id !== message.conversation_id) return c;
          const mine = message.sender_member_id === c.my_member.id;
          const newer = !c.last_message || c.last_message.created_at <= message.created_at;
          return {
            ...c,
            last_message: newer ? message : c.last_message,
            last_message_at: newer ? message.created_at : c.last_message_at,
            unread_count:
              mine || viewing || c.last_message?.id === message.id
                ? c.unread_count
                : c.unread_count + 1,
          };
        }),
      })),
    };
    return bumpToTop(updated, message.conversation_id);
  });
  return known;
}

export function markDeleted(
  queryClient: QueryClient,
  conversationId: string,
  messageId: string,
): void {
  const erase = (m: MessagePublic): MessagePublic =>
    m.id === messageId ? { ...m, body: null, deleted: true } : m;
  queryClient.setQueryData<MessagesData>(chatKeys.messages(conversationId), (data) =>
    data
      ? { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map(erase) })) }
      : data,
  );
  updateConversation(queryClient, conversationId, (c) =>
    c.last_message ? { ...c, last_message: erase(c.last_message) } : c,
  );
}

/** Every conversation id in the loaded lists (to subscribe the socket to). */
export function loadedConversationIds(queryClient: QueryClient): string[] {
  const ids = new Set<string>();
  for (const [key, data] of queryClient.getQueriesData<ListData>({ queryKey: chatKeys.all })) {
    if (typeof key[1] !== 'object') continue;
    data?.pages.forEach((page) => {
      page.items.forEach((c) => ids.add(c.id));
    });
  }
  return [...ids];
}
