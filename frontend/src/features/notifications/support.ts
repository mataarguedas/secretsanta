import { useSyncExternalStore } from 'react';

/**
 * What this browser can do for push (CLAUDE.md §8, FR-NTF-1/9):
 * - `supported`: service workers, PushManager and Notification all exist
 * - `ios`: iPhone/iPad (iPadOS Safari reports "Macintosh", but has touch)
 * - `standalone`: launched from the Home Screen / as an installed app
 * - `permission`: the current Notification permission, or 'unsupported'
 *
 * On iOS, Web Push only exists inside the installed app (16.4+), so iOS in a browser tab
 * gets the install guide instead of an enable button.
 */
export interface PushSupport {
  supported: boolean;
  ios: boolean;
  standalone: boolean;
  permission: NotificationPermission | 'unsupported';
}

export type PushMode =
  | 'ios-install' // iOS, not installed: show the Add to Home Screen guide
  | 'unsupported'
  | 'denied'
  | 'default' // can ask (on a click only)
  | 'granted';

/** The bits of `window` the detection reads; tests pass their own. */
export interface PushEnvironment {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  notificationPermission: NotificationPermission | undefined;
  /** Safari's non-standard `navigator.standalone`. */
  navigatorStandalone: boolean | undefined;
  displayModeStandalone: boolean;
}

export function isIos(env: Pick<PushEnvironment, 'userAgent' | 'platform' | 'maxTouchPoints'>) {
  return (
    /iPad|iPhone|iPod/.test(env.userAgent) ||
    (env.platform === 'MacIntel' && env.maxTouchPoints > 1)
  );
}

export function detectPushSupport(env: PushEnvironment): PushSupport {
  const hasNotification = env.notificationPermission !== undefined;
  return {
    supported: env.hasServiceWorker && env.hasPushManager && hasNotification,
    ios: isIos(env),
    standalone: env.navigatorStandalone === true || env.displayModeStandalone,
    permission: env.notificationPermission ?? 'unsupported',
  };
}

export function pushMode(support: PushSupport): PushMode {
  if (support.ios && !support.standalone) return 'ios-install';
  if (!support.supported || support.permission === 'unsupported') return 'unsupported';
  return support.permission;
}

const STANDALONE_QUERY = '(display-mode: standalone)';

export function readEnvironment(): PushEnvironment {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    hasServiceWorker: 'serviceWorker' in nav,
    hasPushManager: 'PushManager' in window,
    notificationPermission: 'Notification' in window ? Notification.permission : undefined,
    navigatorStandalone: nav.standalone,
    displayModeStandalone:
      typeof window.matchMedia === 'function' && window.matchMedia(STANDALONE_QUERY).matches,
  };
}

// ── A tiny store, so a permission change made by one component re-renders the others ──

const listeners = new Set<() => void>();
let snapshot: PushSupport | null = null;
let snapshotKey = '';

function read(): PushSupport {
  const next = detectPushSupport(readEnvironment());
  const key = JSON.stringify(next);
  if (!snapshot || key !== snapshotKey) {
    snapshot = next;
    snapshotKey = key;
  }
  return snapshot;
}

/** Re-read after something changed it (e.g. `Notification.requestPermission()`). */
export function refreshPushSupport(): void {
  listeners.forEach((listener) => {
    listener();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media =
    typeof window.matchMedia === 'function' ? window.matchMedia(STANDALONE_QUERY) : null;
  media?.addEventListener('change', listener);
  // Permission can also change in the browser's site settings while the tab is hidden.
  document.addEventListener('visibilitychange', listener);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener('change', listener);
    document.removeEventListener('visibilitychange', listener);
  };
}

export function usePushSupport(): PushSupport & { mode: PushMode } {
  const support = useSyncExternalStore(subscribe, read);
  return { ...support, mode: pushMode(support) };
}
