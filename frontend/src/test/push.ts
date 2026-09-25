import { vi } from 'vitest';

/**
 * A fake browser push environment for jsdom, which has no Notification, PushManager or
 * service worker. `restore()` undoes it (call it in afterEach).
 */
export const UA = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
} as const;

export interface FakePushOptions {
  /** `false`: no Notification / PushManager / service worker at all. */
  supported?: boolean;
  permission?: NotificationPermission;
  /** What the permission prompt answers. */
  answer?: NotificationPermission;
  userAgent?: string;
  standalone?: boolean;
  /** A push subscription this browser already has. */
  existing?: boolean;
}

export interface FakePush {
  requestPermission: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  restore: () => void;
}

export function fakeSubscription(endpoint: string, unsubscribe: () => Promise<boolean>) {
  return {
    endpoint,
    options: { applicationServerKey: null },
    unsubscribe,
    toJSON: () => ({
      endpoint,
      expirationTime: null,
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    }),
  };
}

export function fakePush({
  supported = true,
  permission = 'default',
  answer = 'granted',
  userAgent = UA.chromeWindows,
  standalone = false,
  existing = false,
}: FakePushOptions = {}): FakePush {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: standalone && query === '(display-mode: standalone)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );

  const unsubscribe = vi.fn(() => {
    current = null;
    return Promise.resolve(true);
  });
  let current: ReturnType<typeof fakeSubscription> | null = existing
    ? fakeSubscription('https://fcm.googleapis.com/fcm/send/existing', unsubscribe)
    : null;
  const subscribe = vi.fn(() => {
    current = fakeSubscription('https://fcm.googleapis.com/fcm/send/new', unsubscribe);
    return Promise.resolve(current);
  });
  const requestPermission = vi.fn(() => {
    notification.permission = answer;
    return Promise.resolve(answer);
  });
  const notification = { permission, requestPermission };

  if (supported) {
    vi.stubGlobal('Notification', notification);
    vi.stubGlobal('PushManager', vi.fn()); // only its existence is checked
    const registration = {
      pushManager: { getSubscription: () => Promise.resolve(current), subscribe },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve(registration),
        getRegistration: () => Promise.resolve(registration),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
  }

  return {
    requestPermission,
    subscribe,
    unsubscribe,
    restore: () => {
      // vi.unstubAllGlobals (setup.ts) restores the globals; this one is a navigator prop.
      Reflect.deleteProperty(navigator, 'serviceWorker');
      try {
        localStorage.clear();
      } catch {
        // ignore
      }
    },
  };
}
