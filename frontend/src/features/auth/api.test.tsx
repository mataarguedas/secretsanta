import { renderHook, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';
import { createApiClient } from '@/lib/apiClient';
import { createTestQueryClient, jsonResponse, mockSession, TEST_USER } from '@/test/render';

import { bindSessionToQueryClient, ME_QUERY_KEY, useLogout, useMe } from './api';

function wrapperFor(queryClient: QueryClient, path = '/') {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppProviders queryClient={queryClient}>
        <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
      </AppProviders>
    );
  };
}

describe('useMe', () => {
  it('returns the user when signed in', async () => {
    mockSession({ me: TEST_USER });
    const { result } = renderHook(() => useMe(), { wrapper: wrapperFor(createTestQueryClient()) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(TEST_USER);
  });

  it('401 → refresh fails → signed out (null), not an error', async () => {
    const { calls } = mockSession({ me: null });
    const { result } = renderHook(() => useMe(), { wrapper: wrapperFor(createTestQueryClient()) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
    expect(calls()).toEqual(['GET /api/v1/me', 'POST /api/v1/auth/refresh']);
  });

  it('silently refreshes an expired access token', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'AUTH_REQUIRED' } }))
      .mockResolvedValueOnce(jsonResponse(200, { status: 'ok' }))
      .mockResolvedValueOnce(jsonResponse(200, TEST_USER));
    const { result } = renderHook(() => useMe(), { wrapper: wrapperFor(createTestQueryClient()) });
    await waitFor(() => {
      expect(result.current.data).toEqual(TEST_USER);
    });
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/me',
      '/api/v1/auth/refresh',
      '/api/v1/me',
    ]);
  });

  it('a network failure is an error, not a sign-out', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useMe(), { wrapper: wrapperFor(createTestQueryClient()) });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.data).toBeUndefined();
  });
});

describe('bindSessionToQueryClient', () => {
  it('marks the session signed out when a refresh fails anywhere', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/auth/refresh')
          ? jsonResponse(401, { error: { code: 'AUTH_REFRESH_INVALID' } })
          : jsonResponse(401, { error: { code: 'AUTH_REQUIRED' } }),
      ),
    );
    const client = createApiClient({ fetch: fetchMock as unknown as typeof fetch });
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(ME_QUERY_KEY, TEST_USER);

    const unbind = bindSessionToQueryClient(client, queryClient);
    await expect(client.get('/events')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(queryClient.getQueryData(ME_QUERY_KEY)).toBeNull();

    unbind();
    queryClient.setQueryData(ME_QUERY_KEY, TEST_USER);
    await expect(client.get('/events')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(queryClient.getQueryData(ME_QUERY_KEY)).toEqual(TEST_USER);
  });
});

describe('useLogout', () => {
  it('posts /auth/logout, clears the cache and goes to /', async () => {
    const { calls, initOf } = mockSession({ me: TEST_USER });
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(ME_QUERY_KEY, TEST_USER);
    queryClient.setQueryData(['events', '1'], { id: '1' });

    const Providers = wrapperFor(queryClient, '/profile');
    const { result } = renderHook(() => ({ logout: useLogout(), location: useLocation() }), {
      wrapper: ({ children }) => (
        <Providers>
          <Routes>
            <Route path="*" element={children} />
          </Routes>
        </Providers>
      ),
    });
    expect(result.current.location.pathname).toBe('/profile');

    await act(async () => {
      await result.current.logout.mutateAsync();
    });

    expect(calls()).toContain('POST /api/v1/auth/logout');
    expect(
      (initOf('/api/v1/auth/logout')?.headers as Record<string, string>)['X-Requested-With'],
    ).toBe('fetch');
    expect(queryClient.getQueryData(ME_QUERY_KEY)).toBeNull();
    expect(queryClient.getQueryData(['events', '1'])).toBeUndefined();
    expect(result.current.location.pathname).toBe('/');
  });
});
