import type { Breadcrumb, ErrorEvent } from '@sentry/react';

/**
 * Frontend error reporting. Off unless VITE_SENTRY_DSN is set at build time; the SDK is a
 * separate chunk, loaded only then. No replay, no tracing, no PII, and nothing that could
 * carry a secret (the SDK sends no PII by default): request bodies, cookies, query strings (OAuth code/state, `next`), URL
 * fragments, invite tokens, and console breadcrumbs (which could echo a
 * message body) are all dropped before anything leaves the browser.
 */

// `/join/:token` pages and the `/api/v1/invites/:token` calls they make.
const INVITE_TOKEN = /\/(join|invites)\/[^/?#]+/g;

/** A URL (absolute or a path) without its query, fragment or invite token. */
export function scrubUrl(url: string): string {
  const withoutQuery = url.split(/[?#]/, 1)[0] ?? '';
  return withoutQuery.replace(INVITE_TOKEN, '/$1/[token]');
}

function scrubUrlField(data: Record<string, unknown> | undefined, field: string): void {
  const value = data?.[field];
  if (data && typeof value === 'string') data[field] = scrubUrl(value);
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (crumb.category === 'console') return null;
  if (!crumb.data) return crumb;
  const data = { ...crumb.data };
  for (const field of ['url', 'from', 'to']) scrubUrlField(data, field);
  delete data.request_body;
  delete data.response_body;
  return { ...crumb, data };
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const scrubbed: ErrorEvent = { ...event };
  if (event.request) {
    const { url, headers } = event.request;
    const safeHeaders: Record<string, string> = {};
    if (headers?.['User-Agent']) safeHeaders['User-Agent'] = headers['User-Agent'];
    if (headers?.Referer) safeHeaders.Referer = scrubUrl(headers.Referer);
    scrubbed.request = { headers: safeHeaders };
    if (url !== undefined) scrubbed.request.url = scrubUrl(url);
  }
  if (event.breadcrumbs) {
    scrubbed.breadcrumbs = event.breadcrumbs
      .map(scrubBreadcrumb)
      .filter((crumb): crumb is Breadcrumb => crumb !== null);
  }
  return scrubbed;
}

export async function initSentry(): Promise<boolean> {
  // Replaced at build time: without a DSN the import below is dead code, so the SDK isn't
  // bundled (or precached by the service worker) at all.
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return false;
  const Sentry = await import('@sentry/react');
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
  return true;
}
