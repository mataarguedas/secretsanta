import type { QueryClient } from '@tanstack/react-query';

import { eventKeys } from '@/features/events/api';
import type { ServerFrame } from '@/lib/ws';

import {
  applyIncomingMessage,
  invalidateConversationLists,
  markDeleted,
  type MessagePublic,
} from './api';

/** Server frame → TanStack cache (CLAUDE.md §8). `viewing`: the thread on screen. */
export function applyFrame(
  queryClient: QueryClient,
  frame: ServerFrame,
  viewing: string | null,
): void {
  switch (frame.type) {
    case 'message': {
      const message = frame.message as MessagePublic;
      const known = applyIncomingMessage(queryClient, message, {
        viewing: viewing === message.conversation_id,
      });
      if (!known) void invalidateConversationLists(queryClient);
      break;
    }
    case 'message_deleted':
      markDeleted(queryClient, String(frame.conversation_id), String(frame.message_id));
      break;
    case 'event_drawn':
      void queryClient.invalidateQueries({ queryKey: eventKeys.detail(String(frame.event_id)) });
      void queryClient.invalidateQueries({ queryKey: eventKeys.all });
      break;
    case 'conversation_created':
      void invalidateConversationLists(queryClient);
      break;
    default:
      break;
  }
}
