import type { InfiniteData } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { eventKeys } from '@/features/events/api';
import { conversation, createTestQueryClient, message, MY_MEMBER } from '@/test/render';

import { chatKeys, type ConversationPage, type MessagePage } from './api';
import { applyFrame } from './frames';

const page = <T>(items: T[]) => ({ pageParams: [null], pages: [{ items, next_cursor: null }] });

function seeded() {
  const queryClient = createTestQueryClient();
  const first = conversation({ id: 'c1' });
  const second = conversation({ id: 'c2', unread_count: 1 });
  queryClient.setQueryData(chatKeys.list(), page([first, second]));
  queryClient.setQueryData(chatKeys.list(first.event.id), page([first, second]));
  queryClient.setQueryData(
    chatKeys.messages('c2'),
    page([message({ id: 'old', conversation_id: 'c2' })]),
  );
  const list = (eventId?: string) =>
    queryClient.getQueryData<InfiniteData<ConversationPage>>(chatKeys.list(eventId))?.pages[0]
      ?.items ?? [];
  const thread = (id: string) =>
    queryClient.getQueryData<InfiniteData<MessagePage>>(chatKeys.messages(id))?.pages[0]?.items ??
    [];
  return { queryClient, list, thread, eventId: first.event.id };
}

describe('applyFrame', () => {
  it('message: appended to the thread, previewed, bumped to the top, counted unread', () => {
    const { queryClient, list, thread, eventId } = seeded();
    const incoming = message({ id: 'new', conversation_id: 'c2', body: '¿Talla?' });
    applyFrame(queryClient, { type: 'message', conversation_id: 'c2', message: incoming }, null);

    expect(thread('c2').map((m) => m.id)).toEqual(['new', 'old']);
    for (const items of [list(), list(eventId)]) {
      expect(items.map((c) => c.id)).toEqual(['c2', 'c1']);
      expect(items[0]).toMatchObject({
        last_message: incoming,
        last_message_at: incoming.created_at,
        unread_count: 2,
      });
    }

    // The same frame twice (e.g. after an ack already added it) changes nothing.
    applyFrame(queryClient, { type: 'message', conversation_id: 'c2', message: incoming }, null);
    expect(thread('c2')).toHaveLength(2);
    expect(list()[0]?.unread_count).toBe(2);
  });

  it('my own messages and the thread on screen are not unread', () => {
    const { queryClient, list } = seeded();
    const mine = message({ id: 'm', conversation_id: 'c1', sender_member_id: MY_MEMBER.id });
    applyFrame(queryClient, { type: 'message', message: mine }, null);
    expect(list()[0]).toMatchObject({ id: 'c1', unread_count: 0 });
    const seen = message({ id: 's', conversation_id: 'c1' });
    applyFrame(queryClient, { type: 'message', message: seen }, 'c1');
    expect(list()[0]).toMatchObject({ id: 'c1', unread_count: 0, last_message: seen });
  });

  it('a message for a conversation not in any list refetches the lists', () => {
    const { queryClient } = seeded();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    applyFrame(queryClient, { type: 'message', message: message({ conversation_id: 'c9' }) }, null);
    expect(spy).toHaveBeenCalled();
  });

  it('message_deleted: the body is gone in the thread and the preview', () => {
    const { queryClient, list, thread } = seeded();
    const last = message({ id: 'old', conversation_id: 'c2' });
    applyFrame(queryClient, { type: 'message', message: last }, null);
    applyFrame(
      queryClient,
      { type: 'message_deleted', conversation_id: 'c2', message_id: 'old' },
      null,
    );
    expect(thread('c2')[0]).toMatchObject({ id: 'old', body: null, deleted: true });
    expect(list()[0]?.last_message).toMatchObject({ body: null, deleted: true });
  });

  it('conversation_created refetches the lists; event_drawn the event', () => {
    const { queryClient } = seeded();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    applyFrame(queryClient, { type: 'conversation_created', conversation_id: 'c3' }, null);
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ queryKey: chatKeys.all }));
    applyFrame(queryClient, { type: 'event_drawn', event_id: 'e1' }, null);
    expect(spy).toHaveBeenCalledWith({ queryKey: eventKeys.detail('e1') });
  });
});
