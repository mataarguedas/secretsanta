import { afterEach, describe, expect, it } from 'vitest';

import { fakePush, UA } from '@/test/push';

import {
  detectPushSupport,
  isIos,
  pushMode,
  readEnvironment,
  type PushEnvironment,
  type PushMode,
} from './support';

const BASE: PushEnvironment = {
  userAgent: UA.chromeWindows,
  platform: 'Win32',
  maxTouchPoints: 0,
  hasServiceWorker: true,
  hasPushManager: true,
  notificationPermission: 'default',
  navigatorStandalone: undefined,
  displayModeStandalone: false,
};

const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

describe('push support matrix', () => {
  it.each<[string, Partial<PushEnvironment>, PushMode]>([
    ['desktop Chrome, not asked yet', {}, 'default'],
    ['desktop Chrome, allowed', { notificationPermission: 'granted' }, 'granted'],
    ['desktop Chrome, blocked', { notificationPermission: 'denied' }, 'denied'],
    ['Android Firefox', { userAgent: UA.firefoxAndroid, platform: 'Linux armv8l' }, 'default'],
    [
      'iPhone Safari tab (no push there)',
      {
        userAgent: UA.safariIphone,
        platform: 'iPhone',
        hasPushManager: false,
        notificationPermission: undefined,
      },
      'ios-install',
    ],
    [
      'iPhone installed app (iOS 16.4+)',
      { userAgent: UA.safariIphone, platform: 'iPhone', navigatorStandalone: true },
      'default',
    ],
    [
      'iPhone installed, older iOS without push',
      {
        userAgent: UA.safariIphone,
        platform: 'iPhone',
        navigatorStandalone: true,
        hasPushManager: false,
      },
      'unsupported',
    ],
    [
      'iPad in desktop mode (says Macintosh, has touch)',
      { userAgent: IPAD_DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 5 },
      'ios-install',
    ],
    [
      'Mac Safari (no touch): not iOS',
      { userAgent: IPAD_DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 0 },
      'default',
    ],
    ['installed desktop PWA', { displayModeStandalone: true }, 'default'],
    ['no service worker', { hasServiceWorker: false }, 'unsupported'],
    ['no Notification API', { notificationPermission: undefined }, 'unsupported'],
  ])('%s → %s', (_name, overrides, mode) => {
    expect(pushMode(detectPushSupport({ ...BASE, ...overrides }))).toBe(mode);
  });

  it('standalone comes from navigator.standalone or the display mode', () => {
    expect(detectPushSupport(BASE).standalone).toBe(false);
    expect(detectPushSupport({ ...BASE, navigatorStandalone: true }).standalone).toBe(true);
    expect(detectPushSupport({ ...BASE, displayModeStandalone: true }).standalone).toBe(true);
    expect(detectPushSupport({ ...BASE, navigatorStandalone: false }).standalone).toBe(false);
  });

  it('isIos', () => {
    expect(isIos({ userAgent: UA.safariIphone, platform: 'iPhone', maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: UA.chromeWindows, platform: 'Win32', maxTouchPoints: 10 })).toBe(
      false,
    );
  });
});

describe('readEnvironment', () => {
  let restore: () => void = () => undefined;
  afterEach(() => {
    restore();
  });

  it('reads the real browser globals', () => {
    restore = fakePush({ permission: 'granted', standalone: true }).restore;
    expect(readEnvironment()).toMatchObject({
      userAgent: UA.chromeWindows,
      hasServiceWorker: true,
      hasPushManager: true,
      notificationPermission: 'granted',
      displayModeStandalone: true,
    });
  });

  it('jsdom as-is has no push at all', () => {
    expect(readEnvironment()).toMatchObject({
      hasServiceWorker: false,
      hasPushManager: false,
      notificationPermission: undefined,
      displayModeStandalone: false,
    });
  });
});
