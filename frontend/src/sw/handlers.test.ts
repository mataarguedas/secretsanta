import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_TITLE,
  handleNotificationClick,
  handlePush,
  NAVIGATE_MESSAGE,
  NOTIFICATION_BADGE,
  NOTIFICATION_ICON,
  parsePush,
  safePath,
  type NotificationClickEventLike,
  type PushEventLike,
  type WorkerScope,
} from './handlers';

const ORIGIN = 'https://santa.example';

function mockSelf(windows: { url: string }[] = []) {
  const clients = windows.map((w) => ({
    url: w.url,
    focus: vi.fn(() => Promise.resolve(undefined)),
    postMessage: vi.fn(),
  }));
  const scope = {
    location: { origin: ORIGIN },
    registration: { showNotification: vi.fn(() => Promise.resolve()) },
    clients: {
      matchAll: vi.fn(() => Promise.resolve(clients)),
      openWindow: vi.fn(() => Promise.resolve(null)),
    },
  } satisfies WorkerScope;
  return { scope, clients };
}

function pushEvent(data: unknown, raw = false) {
  const waits: Promise<unknown>[] = [];
  const event: PushEventLike = {
    data:
      data === undefined
        ? null
        : {
            json: () => {
              if (raw) throw new SyntaxError('not json');
              return data;
            },
          },
    waitUntil: (p) => waits.push(p),
  };
  return { event, settled: () => Promise.all(waits) };
}

function clickEvent(data: unknown) {
  const waits: Promise<unknown>[] = [];
  const close = vi.fn();
  const event: NotificationClickEventLike = {
    notification: { data, close },
    waitUntil: (p) => waits.push(p),
  };
  return { event, close, settled: () => Promise.all(waits) };
}

describe('push handler', () => {
  it('shows the notification with body, tag, url, icon and badge', async () => {
    const { scope } = mockSelf();
    const { event, settled } = pushEvent({
      title: 'Oficina 2026',
      body: 'Elfo secreto #3: ¿Qué talla usás?',
      tag: 'conv:c1',
      url: '/chats/c1',
    });
    handlePush(scope, event);
    await settled();
    expect(scope.registration.showNotification).toHaveBeenCalledWith('Oficina 2026', {
      body: 'Elfo secreto #3: ¿Qué talla usás?',
      tag: 'conv:c1',
      data: { url: '/chats/c1' },
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
    });
  });

  it('keeps the worker alive until the notification is shown (waitUntil)', () => {
    const { scope } = mockSelf();
    const waitUntil = vi.fn();
    handlePush(scope, { data: { json: () => ({ title: 'x' }) }, waitUntil });
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  it('empty, malformed or non-JSON payloads still show something safe', async () => {
    for (const [data, raw] of [
      [undefined, false],
      [null, false],
      ['a string', false],
      [{ title: '  ', body: 42, url: 'https://evil.example/x' }, false],
      ['{', true],
    ] as const) {
      const { scope } = mockSelf();
      const { event, settled } = pushEvent(data, raw);
      handlePush(scope, event);
      await settled();
      expect(scope.registration.showNotification).toHaveBeenCalledWith(DEFAULT_TITLE, {
        body: '',
        data: { url: '/' },
        icon: NOTIFICATION_ICON,
        badge: NOTIFICATION_BADGE,
      });
    }
  });

  it('parsePush keeps only same-origin paths', () => {
    expect(parsePush({ json: () => ({ url: '/profile?x=1#y' }) }, ORIGIN).url).toBe(
      '/profile?x=1#y',
    );
    for (const url of ['//evil.example/', 'https://evil.example/', 'javascript:alert(1)', 5]) {
      expect(safePath(url, ORIGIN)).toBe('/');
    }
  });
});

describe('notificationclick handler', () => {
  it('focuses an open tab of the app and navigates it', async () => {
    const { scope, clients } = mockSelf([
      { url: 'https://other.example/' },
      { url: `${ORIGIN}/events/e1` },
    ]);
    const { event, close, settled } = clickEvent({ url: '/profile' });
    handleNotificationClick(scope, event);
    await settled();

    expect(close).toHaveBeenCalled();
    expect(scope.clients.matchAll).toHaveBeenCalledWith({
      type: 'window',
      includeUncontrolled: true,
    });
    const [other, app] = clients;
    expect(other?.focus).not.toHaveBeenCalled();
    expect(app?.focus).toHaveBeenCalled();
    expect(app?.postMessage).toHaveBeenCalledWith({ type: NAVIGATE_MESSAGE, url: '/profile' });
    expect(scope.clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens a new window when no tab is open', async () => {
    const { scope } = mockSelf([{ url: 'https://other.example/' }]);
    const { event, settled } = clickEvent({ url: '/chats/c1' });
    handleNotificationClick(scope, event);
    await settled();
    expect(scope.clients.openWindow).toHaveBeenCalledWith('/chats/c1');
  });

  it('never follows a foreign URL from the payload', async () => {
    const { scope } = mockSelf();
    const { event, settled } = clickEvent({ url: 'https://evil.example/phish' });
    handleNotificationClick(scope, event);
    await settled();
    expect(scope.clients.openWindow).toHaveBeenCalledWith('/');
  });

  it('without data it opens the dashboard', async () => {
    const { scope } = mockSelf();
    const { event, settled } = clickEvent(undefined);
    handleNotificationClick(scope, event);
    await settled();
    expect(scope.clients.openWindow).toHaveBeenCalledWith('/');
  });
});
