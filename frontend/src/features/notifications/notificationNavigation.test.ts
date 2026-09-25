import { describe, expect, it, vi } from 'vitest';

import { NAVIGATE_MESSAGE } from '@/sw/handlers';

import { base64UrlToBytes } from './api';
import { listenForNotificationNavigation } from './notificationNavigation';

describe('listenForNotificationNavigation', () => {
  it("navigates in place on the service worker's message, and only to app paths", () => {
    const container = new EventTarget();
    const navigate = vi.fn();
    const stop = listenForNotificationNavigation(navigate, container);
    const send = (data: unknown) => container.dispatchEvent(new MessageEvent('message', { data }));

    send({ type: NAVIGATE_MESSAGE, url: '/chats/c1' });
    send({ type: NAVIGATE_MESSAGE, url: 'https://evil.example/' });
    send({ type: NAVIGATE_MESSAGE, url: '//evil.example/' });
    send({ type: 'something-else', url: '/profile' });
    send('/profile');
    expect(navigate.mock.calls).toEqual([['/chats/c1']]);

    stop();
    send({ type: NAVIGATE_MESSAGE, url: '/profile' });
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('without service workers it does nothing', () => {
    expect(() => {
      listenForNotificationNavigation(vi.fn(), undefined)();
    }).not.toThrow();
  });
});

describe('base64UrlToBytes', () => {
  it('decodes unpadded base64url', () => {
    expect([...base64UrlToBytes('-_8')]).toEqual([0xfb, 0xff]);
    expect([...base64UrlToBytes('AQID')]).toEqual([1, 2, 3]);
  });
});
