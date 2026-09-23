import { describe, expect, it } from 'vitest';

import { googleLoginUrl, safeNext, signInRedirect } from './next';

describe('safeNext', () => {
  it.each(['/', '/profile', '/profile?tab=x', '/join/abc_DEF-123', '/chats#top', '/@x'])(
    'keeps %s',
    (value) => {
      expect(safeNext(value)).toBe(value);
    },
  );

  it.each([
    null,
    undefined,
    '',
    'profile',
    'https://evil.example',
    'javascript:alert(1)',
    '//evil.example',
    '///evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\u0085evil',
    '/\u007f',
    `/${'a'.repeat(3000)}`,
  ])('rejects %j', (value) => {
    expect(safeNext(value)).toBe('/');
  });
});

describe('signInRedirect', () => {
  it('encodes the full path and query into next', () => {
    expect(signInRedirect('/profile', '?tab=x')).toBe('/?next=%2Fprofile%3Ftab%3Dx');
    expect(signInRedirect('/events/1/chat', '')).toBe('/?next=%2Fevents%2F1%2Fchat');
  });

  it('does not add next for the landing itself', () => {
    expect(signInRedirect('/', '')).toBe('/');
  });
});

describe('googleLoginUrl', () => {
  it('points at the backend login with a validated, encoded next', () => {
    expect(googleLoginUrl('/profile?tab=x')).toBe(
      '/api/v1/auth/google/login?next=%2Fprofile%3Ftab%3Dx',
    );
    expect(googleLoginUrl(null)).toBe('/api/v1/auth/google/login?next=%2F');
    expect(googleLoginUrl('//evil.example')).toBe('/api/v1/auth/google/login?next=%2F');
  });
});
