import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';

import { AppProviders } from '@/app/providers';
import { routes } from '@/app/routes';
import { ToastProvider } from '@/components/ui';
import type { Me } from '@/features/auth/api';
import type { EventSection, EventSummary } from '@/features/events/api';
import i18n from '@/i18n';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

/** Render with the same providers as the app, isolated per test. */
export function renderWithProviders(
  ui: ReactElement,
  options?: RenderOptions & { initialEntries?: string[]; queryClient?: QueryClient },
) {
  const queryClient = options?.queryClient ?? createTestQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <MemoryRouter initialEntries={options?.initialEntries ?? ['/']}>
              {children}
            </MemoryRouter>
          </ToastProvider>
        </QueryClientProvider>
      </I18nextProvider>
    );
  }
  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}

/** The whole app (real routes and providers) at `path`. */
export function renderApp(path: string, queryClient: QueryClient = createTestQueryClient()) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { router, queryClient, ...utils };
}

export const TEST_USER: Me = {
  id: '0193d1c2-aaaa-7bbb-8ccc-123456789abc',
  name: 'Ana Rojas',
  email: 'ana@example.com',
  avatar_url: 'https://lh3.googleusercontent.com/a/ana',
  locale: 'es',
  notify_message: true,
  notify_wishlist: true,
  notify_reminder: true,
};

export function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const AUTH_REQUIRED = { error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } };
const REFRESH_INVALID = {
  error: { code: 'AUTH_REFRESH_INVALID', message: 'Your session has expired.' },
};

export function urlOf(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

/**
 * Fake backend for the session endpoints. `me: null` = signed out (`/me` 401, refresh 401).
 * `PATCH /me` merges the body into the stored user; `GET /events?section=` serves `events`.
 * Returns the fetch spy; `calls()` lists `METHOD path` in order.
 */
export function mockSession({
  me: initial,
  patchError,
  events = {},
  createEvent,
}: {
  me: Me | null;
  /** Make `PATCH /me` fail with this status (e.g. 500) instead of saving. */
  patchError?: number;
  /** Dashboard lists (one page each); sections not given are empty. */
  events?: Partial<Record<EventSection, EventSummary[]>>;
  /** `POST /events` response for a given body (default: 201 with id `new-event`). */
  createEvent?: (body: Record<string, unknown>) => Response;
}) {
  let me = initial;
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = urlOf(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/v1/me' && method === 'GET') {
      return Promise.resolve(me ? jsonResponse(200, me) : jsonResponse(401, AUTH_REQUIRED));
    }
    if (url === '/api/v1/auth/refresh') {
      return Promise.resolve(
        me ? jsonResponse(200, { status: 'ok' }) : jsonResponse(401, REFRESH_INVALID),
      );
    }
    if (url === '/api/v1/me' && method === 'PATCH' && me) {
      if (patchError) {
        return Promise.resolve(
          jsonResponse(patchError, { error: { code: 'INTERNAL_ERROR', message: '' } }),
        );
      }
      me = { ...me, ...(JSON.parse(init?.body as string) as Partial<Me>) };
      return Promise.resolve(jsonResponse(200, me));
    }
    if (url === '/api/v1/events' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      return Promise.resolve(
        createEvent ? createEvent(body) : jsonResponse(201, { ...body, id: 'new-event' }),
      );
    }
    if (url.startsWith('/api/v1/events?') && method === 'GET') {
      const section = new URL(url, 'http://x').searchParams.get('section') as EventSection;
      return Promise.resolve(
        jsonResponse(200, { items: events[section] ?? [], next_cursor: null }),
      );
    }
    if (url === '/api/v1/auth/logout') return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: '' } }));
  });
  const calls = () =>
    spy.mock.calls.map(([input, init]) => `${init?.method ?? 'GET'} ${urlOf(input)}`);
  const initOf = (path: string) => spy.mock.calls.find(([input]) => urlOf(input) === path)?.[1];
  return { spy, calls, initOf };
}

export function eventSummary(overrides: Partial<EventSummary> = {}): EventSummary {
  return {
    id: '0193d1c2-0000-7000-8000-000000000001',
    name: 'Oficina 2026',
    state: 'open',
    participant_count: 1,
    exchange_at: '2026-12-20T19:00:00-06:00',
    budget_crc: 25000,
    is_host: true,
    ...overrides,
  };
}
