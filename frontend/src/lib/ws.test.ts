import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeWebSocket } from '@/test/fakeWebSocket';

import {
  ACK_TIMEOUT_MS,
  backoffDelay,
  HEARTBEAT_MS,
  MAX_BACKOFF_MS,
  RealtimeClient,
  RealtimeError,
  realtimeUrl,
  type RealtimeClientOptions,
  type ServerFrame,
} from './ws';

function setup(options: Partial<RealtimeClientOptions> = {}) {
  const frames: ServerFrame[] = [];
  const statuses: string[] = [];
  const client = new RealtimeClient({
    url: 'ws://app.test/ws',
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    random: () => 1, // the top of each backoff window, so delays are predictable
    onFrame: (frame) => frames.push(frame),
    ...options,
  });
  client.onStatus((status) => statuses.push(status));
  client.start();
  const socket = () => {
    const latest = FakeWebSocket.latest();
    if (!latest) throw new Error('no socket');
    return latest;
  };
  return { client, frames, statuses, socket };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('backoffDelay', () => {
  it('doubles from 500 ms, caps at 30 s, and applies full jitter', () => {
    const top = () => 1;
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((n) => backoffDelay(n, top))).toEqual([
      500,
      1000,
      2000,
      4000,
      8000,
      16000,
      MAX_BACKOFF_MS,
      MAX_BACKOFF_MS,
    ]);
    expect(backoffDelay(3, () => 0)).toBe(0);
    expect(backoffDelay(3, () => 0.5)).toBe(2000);
  });
});

describe('RealtimeClient', () => {
  it('connects to the same-origin /ws URL', () => {
    expect(realtimeUrl({ protocol: 'https:', host: 'santa.example' })).toBe(
      'wss://santa.example/ws',
    );
    expect(realtimeUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/ws',
    );
    const { socket, statuses } = setup();
    expect(socket().url).toBe('ws://app.test/ws');
    socket().open();
    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('reconnects with growing backoff and replays subscriptions and the active thread', () => {
    const onReconnect = vi.fn();
    const { client, socket, statuses } = setup({ onReconnect });
    client.subscribe(['c1']); // before open: remembered, sent on open
    client.setActive('c1');
    socket().open();
    expect(socket().frames()).toEqual([
      { type: 'subscribe', conversation_ids: ['c1'] },
      { type: 'active', conversation_id: 'c1' },
    ]);
    client.subscribe(['c1', 'c2']); // only the new id goes out
    expect(socket().frames().at(-1)).toEqual({ type: 'subscribe', conversation_ids: ['c2'] });
    expect(onReconnect).not.toHaveBeenCalled();

    socket().serverClose(1006);
    expect(client.getStatus()).toBe('reconnecting');
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(499);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    socket().serverClose(1006); // failed again before opening: the wait doubles
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);

    socket().open();
    expect(socket().frames()).toEqual([
      { type: 'subscribe', conversation_ids: ['c1', 'c2'] },
      { type: 'active', conversation_id: 'c1' },
    ]);
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe('open');

    // The backoff starts over after a successful connection.
    socket().serverClose(1006);
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it('pings every 25 s while open', () => {
    const { socket } = setup();
    socket().open();
    vi.advanceTimersByTime(HEARTBEAT_MS * 2);
    expect(socket().frames()).toEqual([{ type: 'ping' }, { type: 'ping' }]);
  });

  it('passes server frames on, and swallows pongs', () => {
    const { socket, frames } = setup();
    socket().open();
    socket().receive({ type: 'pong' });
    socket().receive({ type: 'event_drawn', event_id: 'e1' });
    socket().onmessage?.({ data: 'not json' } as MessageEvent);
    expect(frames).toEqual([{ type: 'event_drawn', event_id: 'e1' }]);
  });

  it('sendMessage resolves on its ack and rejects on its error frame', async () => {
    const { client, socket } = setup();
    socket().open();
    const ok = client.sendMessage('c1', 'hola', 'a');
    const bad = client.sendMessage('c1', ' ', 'b');
    expect(socket().frames()).toEqual([
      { type: 'send', conversation_id: 'c1', body: 'hola', client_id: 'a' },
      { type: 'send', conversation_id: 'c1', body: ' ', client_id: 'b' },
    ]);
    socket().receive({ type: 'error', client_id: 'b', code: 'VALIDATION_ERROR' });
    socket().receive({ type: 'ack', client_id: 'a', message_id: 'm1' });
    await expect(ok).resolves.toEqual({ client_id: 'a', message_id: 'm1' });
    await expect(bad).rejects.toEqual(new RealtimeError('VALIDATION_ERROR'));
  });

  it('a send fails when the socket is down, drops, or never acks', async () => {
    const { client, socket } = setup();
    await expect(client.sendMessage('c1', 'x', 'down')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    socket().open();
    const dropped = client.sendMessage('c1', 'x', 'dropped');
    socket().serverClose(1006);
    await expect(dropped).rejects.toMatchObject({ code: 'NETWORK_ERROR' });

    vi.advanceTimersByTime(500);
    socket().open();
    const silent = client.sendMessage('c1', 'x', 'silent');
    vi.advanceTimersByTime(ACK_TIMEOUT_MS);
    await expect(silent).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('on 4401 refreshes the session first, then reconnects or stops', async () => {
    const onUnauthorized = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { client, socket } = setup({ onUnauthorized });
    socket().serverClose(4401);
    await vi.waitFor(() => {
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeWebSocket.instances).toHaveLength(2);

    socket().serverClose(4401);
    await vi.waitFor(() => {
      expect(client.getStatus()).toBe('idle');
    });
    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('stop() closes the socket and never reconnects', () => {
    const { client, socket } = setup();
    socket().open();
    client.stop();
    expect(socket().closedWith).toBe(1000);
    vi.advanceTimersByTime(MAX_BACKOFF_MS * 2);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(client.getStatus()).toBe('idle');
  });
});
