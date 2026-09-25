import type { ErrorEvent } from '@sentry/react';
import { describe, expect, it } from 'vitest';

import { initSentry, scrubBreadcrumb, scrubEvent, scrubUrl } from './sentry';

describe('scrubUrl', () => {
  it('drops queries, fragments and invite tokens', () => {
    expect(scrubUrl('https://santa.test/join/abc_DEF-123?next=%2F#x')).toBe(
      'https://santa.test/join/[token]',
    );
    expect(scrubUrl('/api/v1/auth/google/callback?code=c&state=s')).toBe(
      '/api/v1/auth/google/callback',
    );
    expect(scrubUrl('/api/v1/invites/tok123/join')).toBe('/api/v1/invites/[token]/join');
    expect(scrubUrl('/events/e1/wishlists')).toBe('/events/e1/wishlists');
  });
});

describe('scrubBreadcrumb', () => {
  it('drops console breadcrumbs, which could echo a message body', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'hola secreta' })).toBeNull();
  });

  it('scrubs fetch and navigation URLs and drops bodies', () => {
    expect(
      scrubBreadcrumb({
        category: 'fetch',
        data: { url: '/api/v1/x?token=t', method: 'POST', request_body: '{"body":"hi"}' },
      }),
    ).toEqual({ category: 'fetch', data: { url: '/api/v1/x', method: 'POST' } });
    expect(
      scrubBreadcrumb({ category: 'navigation', data: { from: '/join/secret', to: '/?next=/x' } }),
    ).toEqual({ category: 'navigation', data: { from: '/join/[token]', to: '/' } });
  });
});

describe('scrubEvent', () => {
  it('keeps only a scrubbed URL and harmless headers', () => {
    const event: ErrorEvent = {
      type: undefined,
      request: {
        url: 'https://santa.test/join/secret?x=1',
        headers: { 'User-Agent': 'ua', Referer: 'https://santa.test/join/other', Cookie: 'c=1' },
        cookies: { access_token: 'abc' },
        data: { body: 'hola' },
        query_string: 'code=1',
      },
      breadcrumbs: [
        { category: 'console', message: 'hola' },
        { category: 'fetch', data: { url: '/api/v1/y?code=2' } },
      ],
    };
    const out = scrubEvent(event);
    expect(out.request).toEqual({
      url: 'https://santa.test/join/[token]',
      headers: { 'User-Agent': 'ua', Referer: 'https://santa.test/join/[token]' },
    });
    expect(out.breadcrumbs).toEqual([{ category: 'fetch', data: { url: '/api/v1/y' } }]);
    const raw = JSON.stringify(out);
    for (const secret of ['secret', 'other', 'abc', 'hola', 'code=']) {
      expect(raw).not.toContain(secret);
    }
  });
});

describe('initSentry', () => {
  it('stays off without a DSN', async () => {
    await expect(initSentry()).resolves.toBe(false);
  });
});
