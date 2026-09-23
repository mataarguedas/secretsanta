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
import type { EventDetail, EventSection, EventSummary, Participant } from '@/features/events/api';
import type { InvitePreview } from '@/features/invites/api';
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
  eventDetails = {},
  invites = {},
  joinResponse,
  participants = {},
}: {
  me: Me | null;
  /** Make `PATCH /me` fail with this status (e.g. 500) instead of saving. */
  patchError?: number;
  /** Dashboard lists (one page each); sections not given are empty. */
  events?: Partial<Record<EventSection, EventSummary[]>>;
  /** `POST /events` response for a given body (default: 201 with id `new-event`). */
  createEvent?: (body: Record<string, unknown>) => Response;
  /** Events the user can open (`GET/PATCH/DELETE /events/{id}`); others are 404. */
  eventDetails?: Record<string, EventDetail>;
  /** `GET /invites/{token}` previews; unknown tokens are 404 INVITE_INVALID. */
  invites?: Record<string, InvitePreview>;
  /** `POST /invites/{token}/join` (default: 200 with event id `joined-event`). */
  joinResponse?: (token: string) => Response;
  /** Rosters by event id (`GET /events/{id}/participants`, remove and leave). */
  participants?: Record<string, Participant[]>;
}) {
  const rosters = new Map(Object.entries(participants));
  let regenerated = 0;
  const details = new Map(Object.entries(eventDetails));
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
        createEvent
          ? createEvent(body)
          : jsonResponse(201, eventDetail({ ...(body as Partial<EventDetail>), id: 'new-event' })),
      );
    }
    if (url.startsWith('/api/v1/events?') && method === 'GET') {
      const section = new URL(url, 'http://x').searchParams.get('section') as EventSection;
      return Promise.resolve(
        jsonResponse(200, { items: events[section] ?? [], next_cursor: null }),
      );
    }
    const rosterMatch = /^\/api\/v1\/events\/([^/?]+)\/(participants(?:\/([^/?]+))?|leave)$/.exec(
      url,
    );
    if (rosterMatch?.[1]) {
      const id = rosterMatch[1];
      const event = details.get(id);
      if (!event) return Promise.resolve(jsonResponse(404, { error: { code: 'EVENT_NOT_FOUND' } }));
      const list = rosters.get(id) ?? [];
      const drop = (userId: string | undefined) => {
        rosters.set(
          id,
          list.filter((p) => p.user_id !== userId),
        );
        details.set(id, { ...event, participant_count: event.participant_count - 1 });
      };
      if (rosterMatch[2] === 'leave') {
        details.delete(id);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (method === 'DELETE') {
        drop(rosterMatch[3]);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse(200, list));
    }
    const inviteMatch = /^\/api\/v1\/events\/([^/?]+)\/invite(\/regenerate)?$/.exec(url);
    if (inviteMatch?.[1]) {
      const id = inviteMatch[1];
      const event = details.get(id);
      if (!event) return Promise.resolve(jsonResponse(404, { error: { code: 'EVENT_NOT_FOUND' } }));
      regenerated += 1;
      const token = inviteMatch[2] ? `regenerated-token-${String(regenerated)}` : null;
      const updated = { ...event, invite_token: token };
      details.set(id, updated);
      return Promise.resolve(jsonResponse(200, updated));
    }
    const tokenMatch = /^\/api\/v1\/invites\/([^/?]+)(\/join)?$/.exec(url);
    if (tokenMatch?.[1]) {
      const token = decodeURIComponent(tokenMatch[1]);
      const preview = invites[token];
      if (!preview) {
        return Promise.resolve(
          jsonResponse(404, { error: { code: 'INVITE_INVALID', message: 'Invalid invite.' } }),
        );
      }
      if (tokenMatch[2]) {
        return Promise.resolve(
          joinResponse ? joinResponse(token) : jsonResponse(200, { event_id: 'joined-event' }),
        );
      }
      return Promise.resolve(jsonResponse(200, preview));
    }
    const detailMatch = /^\/api\/v1\/events\/([^/?]+)$/.exec(url);
    if (detailMatch?.[1]) {
      const id = decodeURIComponent(detailMatch[1]);
      const event = details.get(id);
      if (!event) {
        return Promise.resolve(
          jsonResponse(404, { error: { code: 'EVENT_NOT_FOUND', message: 'Event not found.' } }),
        );
      }
      if (method === 'PATCH') {
        const updated = { ...event, ...(JSON.parse(init?.body as string) as Partial<EventDetail>) };
        details.set(id, updated);
        return Promise.resolve(jsonResponse(200, updated));
      }
      if (method === 'DELETE') {
        details.delete(id);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse(200, event));
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

export function eventDetail(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: 'e1',
    name: 'Familia',
    description: ['Traer algo hecho a mano.', 'Nada de tarjetas de regalo.'].join('\n'),
    budget_crc: 15000,
    exchange_at: '2026-12-20T19:00:00-06:00',
    join_deadline: null,
    location: 'Heredia',
    is_online: false,
    group_chat_enabled: true,
    state: 'open',
    drawn_at: null,
    archived_at: null,
    host: { id: TEST_USER.id, name: TEST_USER.name, avatar_url: TEST_USER.avatar_url },
    participant_count: 3,
    my_role: 'host',
    my_assignment: null,
    invite_token: 'invite-token',
    ...overrides,
  };
}

export function invitePreview(overrides: Partial<InvitePreview> = {}): InvitePreview {
  return {
    event_name: 'Familia',
    host: { id: 'host-id', name: 'Beto Solís', avatar_url: null },
    budget_crc: 15000,
    exchange_at: '2026-12-20T19:00:00-06:00',
    participant_count: 1,
    already_participant: false,
    event_id: null,
    joinable: true,
    reason: null,
    ...overrides,
  };
}

export function participant(overrides: Partial<Participant> = {}): Participant {
  return {
    user_id: 'u-beto',
    name: 'Beto Solís',
    avatar_url: null,
    is_host: false,
    is_self: false,
    joined_at: '2026-09-23T12:00:00Z',
    ...overrides,
  };
}
