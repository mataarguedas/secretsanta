/**
 * The app's single WebSocket (CLAUDE.md §8, PRD §8).
 *
 * - Reconnects with exponential backoff and full jitter, capped at 30 s. A 4401 close
 *   (expired access token) first asks `onUnauthorized` to refresh the session.
 * - Sends a `ping` every 25 s (the server also uses it to keep `active:{user}` alive).
 * - Remembers the subscribed conversations and the active one, and replays both on every
 *   reconnect.
 * - `send` frames resolve on their `ack` and reject on an `error` frame, on disconnect, or
 *   after a timeout, so the caller can mark an optimistic message as failed.
 * - Server frames go to `onFrame`; the chat feature turns them into cache updates.
 */

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting';

export interface ServerFrame {
  type: string;
  [key: string]: unknown;
}

export interface Ack {
  client_id: string;
  message_id: string;
}

/** A frame refused by the server: `code` is a backend error code (`errors.<code>`). */
export class RealtimeError extends Error {
  override readonly name = 'RealtimeError';
  constructor(readonly code: string) {
    super(code);
  }
}

export const HEARTBEAT_MS = 25_000;
export const MAX_BACKOFF_MS = 30_000;
export const BASE_BACKOFF_MS = 500;
export const ACK_TIMEOUT_MS = 10_000;
export const UNAUTHENTICATED_CLOSE = 4401;

export interface RealtimeClientOptions {
  url: string;
  onFrame: (frame: ServerFrame) => void;
  /** After a reconnect (not the first connection): refetch what may have been missed. */
  onReconnect?: () => void;
  /** 4401: refresh the session; resolve true to keep trying, false to stop. */
  onUnauthorized?: () => Promise<boolean>;
  WebSocketImpl?: typeof WebSocket;
  random?: () => number;
}

type Listener = (status: ConnectionStatus) => void;

interface Pending {
  resolve: (ack: Ack) => void;
  reject: (error: RealtimeError) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Full jitter: a random delay in [0, min(cap, base·2^attempt)]. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  return Math.round(random() * ceiling);
}

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private status: ConnectionStatus = 'idle';
  private readonly listeners = new Set<Listener>();
  private readonly subscriptions = new Set<string>();
  private active: string | null = null;
  private readonly pending = new Map<string, Pending>();
  private attempt = 0;
  private everOpened = false;
  private stopped = true;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: RealtimeClientOptions) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close(1000);
    }
    this.failPending('NETWORK_ERROR');
    this.setStatus('idle');
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onStatus(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  isOpen(): boolean {
    return this.status === 'open';
  }

  // ── Frames to the server ───────────────────────────────────────────────────

  /** Additive, like the server. Ids are replayed on reconnect. */
  subscribe(conversationIds: Iterable<string>): void {
    const fresh = [...conversationIds].filter((id) => !this.subscriptions.has(id));
    if (fresh.length === 0) return;
    fresh.forEach((id) => this.subscriptions.add(id));
    this.sendRaw({ type: 'subscribe', conversation_ids: fresh });
  }

  /** The conversation on screen (null when none, or the page is hidden). */
  setActive(conversationId: string | null): void {
    if (this.active === conversationId) return;
    this.active = conversationId;
    this.sendRaw({ type: 'active', conversation_id: conversationId });
  }

  /** Resolves on `ack`; rejects with a RealtimeError (NETWORK_ERROR when the socket's down). */
  sendMessage(conversationId: string, body: string, clientId: string): Promise<Ack> {
    return new Promise((resolve, reject) => {
      if (!this.isOpen()) {
        reject(new RealtimeError('NETWORK_ERROR'));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(clientId);
        reject(new RealtimeError('NETWORK_ERROR'));
      }, ACK_TIMEOUT_MS);
      this.pending.set(clientId, { resolve, reject, timer });
      this.sendRaw({
        type: 'send',
        conversation_id: conversationId,
        body,
        client_id: clientId,
      });
    });
  }

  private sendRaw(frame: Record<string, unknown>): void {
    if (this.socket && this.status === 'open') this.socket.send(JSON.stringify(frame));
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  private connect(): void {
    if (this.stopped) return;
    this.setStatus(this.everOpened || this.attempt > 0 ? 'reconnecting' : 'connecting');
    const Impl = this.options.WebSocketImpl ?? WebSocket;
    let socket: WebSocket;
    try {
      socket = new Impl(this.options.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      const reconnected = this.everOpened;
      this.everOpened = true;
      this.attempt = 0;
      this.setStatus('open');
      if (this.subscriptions.size > 0) {
        this.sendRaw({ type: 'subscribe', conversation_ids: [...this.subscriptions] });
      }
      if (this.active) this.sendRaw({ type: 'active', conversation_id: this.active });
      this.heartbeat = setInterval(() => {
        this.sendRaw({ type: 'ping' });
      }, HEARTBEAT_MS);
      if (reconnected) this.options.onReconnect?.();
    };
    socket.onmessage = (event: MessageEvent) => {
      this.handle(event.data);
    };
    socket.onclose = (event: CloseEvent) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearTimers();
      this.failPending('NETWORK_ERROR');
      if (this.stopped) return;
      if (event.code === UNAUTHENTICATED_CLOSE && this.options.onUnauthorized) {
        this.setStatus('reconnecting');
        void this.options.onUnauthorized().then((keepGoing) => {
          if (keepGoing) this.scheduleReconnect();
          else this.stop();
        });
        return;
      }
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      // A close event always follows; reconnecting happens there.
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.setStatus('reconnecting');
    const delay = backoffDelay(this.attempt, this.options.random);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private handle(data: unknown): void {
    if (typeof data !== 'string') return;
    let frame: ServerFrame;
    try {
      frame = JSON.parse(data) as ServerFrame;
    } catch {
      return;
    }
    if (typeof frame !== 'object' || typeof frame.type !== 'string') return;
    if (frame.type === 'ack' && typeof frame.client_id === 'string') {
      this.settle(frame.client_id, (p) => {
        p.resolve({ client_id: frame.client_id as string, message_id: String(frame.message_id) });
      });
      return;
    }
    if (frame.type === 'error' && typeof frame.client_id === 'string') {
      const code = typeof frame.code === 'string' ? frame.code : 'UNKNOWN_ERROR';
      this.settle(frame.client_id, (p) => {
        p.reject(new RealtimeError(code));
      });
      return;
    }
    if (frame.type === 'pong') return;
    this.options.onFrame(frame);
  }

  private settle(clientId: string, action: (pending: Pending) => void): void {
    const pending = this.pending.get(clientId);
    if (!pending) return;
    this.pending.delete(clientId);
    clearTimeout(pending.timer);
    action(pending);
  }

  private failPending(code: string): void {
    for (const [clientId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new RealtimeError(code));
      this.pending.delete(clientId);
    }
  }

  private clearTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.heartbeat = null;
    this.retryTimer = null;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.listeners.forEach((listener) => {
      listener(status);
    });
  }
}

/** Same origin: `/ws` goes through Vite's proxy in development and Caddy in production. */
export function realtimeUrl(location: Pick<Location, 'protocol' | 'host'> = window.location) {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/ws`;
}
