import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { fetchMe } from '@/features/auth/api';
import { RealtimeClient, realtimeUrl, type ConnectionStatus, type ServerFrame } from '@/lib/ws';

import {
  chatKeys,
  loadedConversationIds,
  type ConversationDetail,
  type MessagePublic,
} from './api';
import { applyFrame } from './frames';
import { memberName } from './members';
import { RealtimeContext } from './realtimeContext';

/**
 * Owns the app's one socket while signed in: frames update the cache, the socket follows
 * every conversation in the loaded lists, and a reconnect refetches chat data so nothing
 * sent meanwhile is missed.
 */
export function RealtimeProvider({
  enabled,
  children,
  WebSocketImpl,
}: {
  enabled: boolean;
  children: ReactNode;
  WebSocketImpl?: typeof WebSocket;
}) {
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const viewing = useRef<string | null>(null);
  const [client, setClient] = useState<RealtimeClient | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [announcement, setAnnouncement] = useState('');

  const announce = useCallback(
    (frame: ServerFrame) => {
      if (frame.type !== 'message') return;
      const message = frame.message as MessagePublic;
      if (message.conversation_id !== viewing.current || message.deleted) return;
      const detail = queryClient.getQueryData<ConversationDetail>(
        chatKeys.detail(message.conversation_id),
      );
      const sender = detail?.members.find((m) => m.id === message.sender_member_id);
      if (!sender || sender.is_self) return;
      setAnnouncement(
        i18n.t('chat.thread.newMessage', {
          name: memberName(i18n.t, sender),
          body: message.body ?? '',
        }),
      );
    },
    [i18n, queryClient],
  );

  useEffect(() => {
    if (!enabled) return undefined;
    const instance = new RealtimeClient({
      url: realtimeUrl(),
      ...(WebSocketImpl ? { WebSocketImpl } : {}),
      onFrame: (frame) => {
        applyFrame(queryClient, frame, viewing.current);
        announce(frame);
      },
      onReconnect: () => {
        void queryClient.invalidateQueries({ queryKey: chatKeys.all });
      },
      onUnauthorized: async () => {
        try {
          return (await fetchMe()) !== null; // runs the refresh flow
        } catch {
          return true; // a network error: keep retrying
        }
      },
    });
    const unsubscribeStatus = instance.onStatus(setStatus);
    const follow = () => {
      instance.subscribe(loadedConversationIds(queryClient));
    };
    const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
      const key = event.query.queryKey as readonly unknown[];
      const root = key[0];
      if (event.type === 'updated' && root === chatKeys.all[0]) follow();
    });
    follow();
    instance.start();
    setClient(instance);
    return () => {
      unsubscribeCache();
      unsubscribeStatus();
      instance.stop();
      setClient(null);
      setStatus('idle');
    };
  }, [enabled, queryClient, WebSocketImpl, announce]);

  const setViewing = useCallback((conversationId: string | null) => {
    viewing.current = conversationId;
  }, []);

  const value = useMemo(
    () => ({ client, status, setViewing, announcement }),
    [client, status, setViewing, announcement],
  );
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
