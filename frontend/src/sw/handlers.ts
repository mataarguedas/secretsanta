/**
 * The service worker's push and notificationclick handlers (CLAUDE.md §8, FR-NTF-8).
 *
 * They take the worker scope as a parameter, typed structurally, so they're unit-testable
 * with a mocked `self` and compile under both the DOM and WebWorker libs. `src/sw.ts`
 * wires them to the real events.
 */

export const NOTIFICATION_ICON = '/icons/icon-192.png';
export const NOTIFICATION_BADGE = '/icons/badge-96.png';
export const DEFAULT_TITLE = 'Secret Santa';

/** The message a notification click posts to an open tab; the app navigates in place. */
export const NAVIGATE_MESSAGE = 'secret-santa:navigate';
export interface NavigateMessage {
  type: typeof NAVIGATE_MESSAGE;
  url: string;
}

/** What the backend sends (`app/notifications/webpush.py`). */
export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url: string;
}

interface WindowClientLike {
  readonly url: string;
  focus(): Promise<unknown>;
  postMessage(message: unknown): void;
}

export interface WorkerScope {
  readonly location: { readonly origin: string };
  readonly registration: {
    showNotification(title: string, options?: NotificationOptions): Promise<void>;
  };
  readonly clients: {
    matchAll(options: {
      type: 'window';
      includeUncontrolled: boolean;
    }): Promise<readonly WindowClientLike[]>;
    openWindow(url: string): Promise<unknown>;
  };
}

interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface PushEventLike extends ExtendableEventLike {
  readonly data: { json(): unknown } | null;
}

export interface NotificationClickEventLike extends ExtendableEventLike {
  readonly notification: { readonly data: unknown; close(): void };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Only a same-origin path is followed: a push can never send the app somewhere else.
 * Anything else (absolute URLs, `//host`, garbage) opens the dashboard.
 */
export function safePath(url: unknown, origin: string): string {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return '/';
  try {
    const resolved = new URL(url, origin);
    if (resolved.origin !== origin) return '/';
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return '/';
  }
}

export function parsePush(data: PushEventLike['data'], origin: string): PushPayload {
  let raw: unknown;
  try {
    raw = data?.json() ?? null;
  } catch {
    raw = null; // not JSON: still show something rather than fail silently
  }
  const fields = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const tag = text(fields.tag);
  return {
    title: text(fields.title) ?? DEFAULT_TITLE,
    body: text(fields.body) ?? '',
    ...(tag ? { tag } : {}),
    url: safePath(fields.url, origin),
  };
}

export function handlePush(scope: WorkerScope, event: PushEventLike): void {
  const payload = parsePush(event.data, scope.location.origin);
  event.waitUntil(
    scope.registration.showNotification(payload.title, {
      body: payload.body,
      // Same tag = the newer notification replaces the older one (group chats, FR-NTF-5).
      ...(payload.tag ? { tag: payload.tag } : {}),
      data: { url: payload.url },
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
    }),
  );
}

export async function openFromNotification(scope: WorkerScope, data: unknown): Promise<void> {
  const url = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const path = safePath(url.url, scope.location.origin);
  const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = windows.find((client) => {
    try {
      return new URL(client.url).origin === scope.location.origin;
    } catch {
      return false;
    }
  });
  if (existing) {
    await existing.focus();
    // The tab already runs the app: it navigates client-side, keeping its socket and cache.
    const message: NavigateMessage = { type: NAVIGATE_MESSAGE, url: path };
    existing.postMessage(message);
    return;
  }
  await scope.clients.openWindow(path);
}

export function handleNotificationClick(
  scope: WorkerScope,
  event: NotificationClickEventLike,
): void {
  event.notification.close();
  event.waitUntil(openFromNotification(scope, event.notification.data));
}
