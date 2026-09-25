import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';

import { ApiError } from '@/lib/apiClient';
import { RealtimeError } from '@/lib/ws';

import { applyIncomingMessage, sendMessageRest } from './api';
import { useRealtime } from './realtimeContext';

/**
 * Optimistic sends (CLAUDE.md §8). A message sits here, shown as pending, until the server
 * confirms it (a WebSocket `ack`, or the REST reply when the socket is down); then it
 * moves into the thread's cache. On failure it stays, marked failed, with a Retry.
 *
 * Kept outside TanStack Query on purpose: a refetch of the thread must not wipe messages
 * that haven't reached the server yet.
 */
export interface OutboxItem {
  client_id: string;
  conversation_id: string;
  body: string;
  created_at: string;
  status: 'pending' | 'failed';
  error?: string;
}

type Listener = () => void;

const items = new Map<string, OutboxItem[]>();
const listeners = new Set<Listener>();
const EMPTY: OutboxItem[] = [];

function emit(): void {
  listeners.forEach((listener) => {
    listener();
  });
}

function setItems(conversationId: string, next: OutboxItem[]): void {
  if (next.length === 0) items.delete(conversationId);
  else items.set(conversationId, next);
  emit();
}

function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const outbox = {
  get: (conversationId: string): OutboxItem[] => items.get(conversationId) ?? EMPTY,
  add(item: OutboxItem): void {
    setItems(item.conversation_id, [...outbox.get(item.conversation_id), item]);
  },
  update(conversationId: string, clientId: string, patch: Partial<OutboxItem>): void {
    setItems(
      conversationId,
      outbox.get(conversationId).map((i) => (i.client_id === clientId ? { ...i, ...patch } : i)),
    );
  },
  remove(conversationId: string, clientId: string): void {
    setItems(
      conversationId,
      outbox.get(conversationId).filter((i) => i.client_id !== clientId),
    );
  },
  subscribe: subscribeOutbox,
  /** Tests only. */
  clear(): void {
    items.clear();
    emit();
  },
};

export function useOutbox(conversationId: string): OutboxItem[] {
  return useSyncExternalStore(subscribeOutbox, () => outbox.get(conversationId));
}

function newClientId(): string {
  return globalThis.crypto.randomUUID();
}

function codeOf(error: unknown): string {
  if (error instanceof RealtimeError || error instanceof ApiError) return error.code;
  return 'UNKNOWN_ERROR';
}

/** `send(body)` and `retry(clientId)` for one thread; `myMemberId` is my member row there. */
export function useSendMessage(conversationId: string, myMemberId: string) {
  const queryClient = useQueryClient();
  const { client } = useRealtime();

  const deliver = useCallback(
    async (item: OutboxItem) => {
      try {
        if (client?.isOpen()) {
          const ack = await client.sendMessage(conversationId, item.body, item.client_id);
          // The `message` frame may come before or after the ack; both paths dedupe by id,
          // and the frame's copy (with the server's timestamp) wins.
          applyIncomingMessage(
            queryClient,
            {
              id: ack.message_id,
              conversation_id: conversationId,
              sender_member_id: myMemberId,
              body: item.body,
              deleted: false,
              created_at: item.created_at,
            },
            { viewing: true },
          );
        } else {
          const message = await sendMessageRest(conversationId, item.body, item.client_id);
          applyIncomingMessage(queryClient, message, { viewing: true });
        }
        outbox.remove(conversationId, item.client_id);
      } catch (error) {
        outbox.update(conversationId, item.client_id, {
          status: 'failed',
          error: codeOf(error),
        });
      }
    },
    [client, conversationId, myMemberId, queryClient],
  );

  const send = useCallback(
    (body: string) => {
      const item: OutboxItem = {
        client_id: newClientId(),
        conversation_id: conversationId,
        body,
        created_at: new Date().toISOString(),
        status: 'pending',
      };
      outbox.add(item);
      void deliver(item);
    },
    [conversationId, deliver],
  );

  const retry = useCallback(
    (clientId: string) => {
      const failed = outbox.get(conversationId).find((i) => i.client_id === clientId);
      if (!failed) return;
      // A fresh client_id, so a late ack for the first attempt can't be mistaken for it.
      outbox.remove(conversationId, clientId);
      const again: OutboxItem = { ...failed, client_id: newClientId(), status: 'pending' };
      delete again.error;
      outbox.add(again);
      void deliver(again);
    },
    [conversationId, deliver],
  );

  return { send, retry };
}
