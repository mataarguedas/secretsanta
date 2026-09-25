import { createContext, useContext } from 'react';

import type { ConnectionStatus, RealtimeClient } from '@/lib/ws';

export interface RealtimeContextValue {
  client: RealtimeClient | null;
  status: ConnectionStatus;
  /** Tell the provider which thread is on screen (null: none, or the page is hidden). */
  setViewing: (conversationId: string | null) => void;
  /** Latest incoming message in the thread on screen, for its aria-live region. */
  announcement: string;
}

export const RealtimeContext = createContext<RealtimeContextValue>({
  client: null,
  status: 'idle',
  setViewing: () => undefined,
  announcement: '',
});

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}

/** 'idle' | 'connecting' | 'open' | 'reconnecting'. */
export function useConnectionStatus(): ConnectionStatus {
  return useContext(RealtimeContext).status;
}
