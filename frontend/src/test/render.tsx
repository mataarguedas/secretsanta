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
import type {
  ConversationDetail,
  ConversationSummary,
  MemberPublic,
  MessagePublic,
} from '@/features/chat/api';
import type { Exclusion, ExclusionList } from '@/features/exclusions/api';
import type { CopySource, ItemPayload, Wishlist, WishlistItem } from '@/features/wishlist/api';
import type { InvitePreview } from '@/features/invites/api';
import type { PushDevice } from '@/features/notifications/api';
import type { DeletionPreview } from '@/features/profile/api';
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

/** A valid-looking VAPID public key (base64url of a 65-byte uncompressed P-256 point). */
export const TEST_VAPID_KEY =
  'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';

export function pushDevice(overrides: Partial<PushDevice> = {}): PushDevice {
  return {
    id: 'device-1',
    browser: 'Chrome',
    os: 'Windows',
    created_at: '2026-09-20T12:00:00Z',
    last_success_at: null,
    ...overrides,
  };
}

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
  exclusions = {},
  exclusionsFeasible = () => true,
  onDraw,
  onArchive,
  coverUpload,
  wishlists = {},
  reorderFails = false,
  photoUpload,
  copySources = {},
  copyItems = {},
  conversations = [],
  messages = {},
  messagePageSize = 50,
  sendFails,
  devices = [],
  vapidKey = TEST_VAPID_KEY,
  deletionPreview = { blocked: false, blocking_events: [], hosted_open_events: [] },
  deleteMe,
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
  /**
   * Exclusion lists by event id. Host events default to an empty, feasible list; non-hosts
   * get 403 HOST_ONLY. POST expands `user_ids` to canonical pairs from the roster.
   */
  exclusions?: Record<string, ExclusionList>;
  /** `feasible` after a POST/DELETE (default: always true). */
  exclusionsFeasible?: (items: Exclusion[]) => boolean;
  /**
   * `POST /events/{id}/draw`: the event as the server has it afterwards (default: the same
   * event with `state: 'drawn'`), or a Response to return instead (e.g. a 409).
   */
  onDraw?: (event: EventDetail) => EventDetail | Response;
  /**
   * `POST /events/{id}/archive`: the event afterwards (default: the same event with
   * `state: 'archived'`), or a Response to return instead (e.g. a 409).
   */
  onArchive?: (event: EventDetail) => EventDetail | Response;
  /**
   * `POST /events/{id}/cover` (multipart, sent through the fake XMLHttpRequest): a Response
   * to return instead of the default success (which sets `cover_url`/`cover_thumb_url`).
   */
  coverUpload?: (eventId: string, file: File) => Response | undefined;
  /** Wishlists by owner user id (any event). Mutations act on the signed-in user's list. */
  wishlists?: Record<string, Wishlist>;
  /** Make `PUT …/wishlist/order` fail with a 500 (to test the optimistic rollback). */
  reorderFails?: boolean;
  /**
   * `POST /wishlist/items/{id}/photos` (through the fake XMLHttpRequest): a Response to
   * return instead of the default, which appends a photo to the signed-in user's item.
   */
  photoUpload?: (itemId: string, file: File) => Response | Promise<Response> | undefined;
  /** `GET /events/{id}/wishlist/copy-sources` by target event id (default: none). */
  copySources?: Record<string, CopySource[]>;
  /** Items that `POST …/wishlist/copy-from/{sourceId}` appends to the user's list. */
  copyItems?: Record<string, WishlistItem[]>;
  /** The user's conversations (with members), newest activity first. */
  conversations?: ConversationDetail[];
  /** History by conversation id, newest first. */
  messages?: Record<string, MessagePublic[]>;
  messagePageSize?: number;
  /** Make REST sends fail with this error code. */
  sendFails?: string;
  /** My push devices (`/push/subscriptions`); a POST upserts by endpoint. */
  devices?: PushDevice[];
  /** `GET /push/vapid-public-key`; `null` = 503 PUSH_NOT_CONFIGURED. */
  vapidKey?: string | null;
  /** `GET /me/deletion-preview`, or a Response to return instead (e.g. a 500). */
  deletionPreview?: DeletionPreview | Response;
  /** `DELETE /me` (default: 204, then signed out: `/me` is 401). */
  deleteMe?: () => Response;
}) {
  const myDevices = new Map(devices.map((d) => [d.id, d]));
  const deviceByEndpoint = new Map<string, string>();
  const lists = new Map(Object.entries(wishlists));
  let itemSeq = 0;
  let photoSeq = 0;
  const convs = new Map(conversations.map((c) => [c.id, c]));
  const history = new Map(Object.entries(messages).map(([id, list]) => [id, [...list]]));
  let messageSeq = 0;
  let convSeq = 0;
  const summaryOf = (c: ConversationDetail): ConversationSummary => {
    const { members: _members, ...summary } = c;
    return summary;
  };
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  let covers = 0;
  const exclusionLists = new Map(Object.entries(exclusions));
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
    if (url === '/api/v1/me/deletion-preview' && me) {
      return Promise.resolve(
        deletionPreview instanceof Response
          ? deletionPreview.clone()
          : jsonResponse(200, deletionPreview),
      );
    }
    if (url === '/api/v1/me' && method === 'DELETE' && me) {
      const response = deleteMe ? deleteMe() : new Response(null, { status: 204 });
      if (response.ok) me = null;
      return Promise.resolve(response);
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
    const listMatch = /^\/api\/v1\/events\/[^/?]+\/wishlists\/([^/?]+)$/.exec(url);
    if (listMatch?.[1]) {
      const list = lists.get(listMatch[1]);
      return Promise.resolve(
        list
          ? jsonResponse(200, list)
          : jsonResponse(404, { error: { code: 'PARTICIPANT_NOT_FOUND', message: '' } }),
      );
    }
    const itemMatch = /^\/api\/v1\/events\/[^/?]+\/wishlist\/(items(?:\/([^/?]+))?|order)$/.exec(
      url,
    );
    if (itemMatch?.[1] && me) {
      const self = me;
      const mine = lists.get(self.id) ?? {
        owner: { id: self.id, name: self.name, avatar_url: self.avatar_url },
        is_self: true,
        items: [],
      };
      const save = (items: WishlistItem[]) => {
        lists.set(self.id, {
          ...mine,
          items: items.map((item, position) => ({ ...item, position })),
        });
      };
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
      if (itemMatch[1] === 'order') {
        if (reorderFails) {
          return Promise.resolve(
            jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: '' } }),
          );
        }
        const { item_ids: ids } = body as { item_ids: string[] };
        const byId = new Map(mine.items.map((item) => [item.id, item]));
        save(ids.map((id) => byId.get(id)).filter((i): i is WishlistItem => i !== undefined));
        return Promise.resolve(jsonResponse(200, lists.get(self.id)?.items));
      }
      const itemId = itemMatch[2];
      if (method === 'POST') {
        itemSeq += 1;
        const item: WishlistItem = {
          id: `item-${String(itemSeq)}`,
          position: mine.items.length,
          photos: [],
          ...(body as ItemPayload),
        };
        save([...mine.items, item]);
        return Promise.resolve(jsonResponse(201, item));
      }
      const found = mine.items.find((item) => item.id === itemId);
      if (!found) {
        return Promise.resolve(
          jsonResponse(404, { error: { code: 'WISHLIST_ITEM_NOT_FOUND', message: '' } }),
        );
      }
      if (method === 'PATCH') {
        const updated = { ...found, ...(body as Partial<ItemPayload>) };
        save(mine.items.map((item) => (item.id === found.id ? updated : item)));
        return Promise.resolve(jsonResponse(200, updated));
      }
      save(mine.items.filter((item) => item.id !== found.id));
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.startsWith('/api/v1/conversations') && me) {
      const parsed = new URL(url, 'http://x');
      const path = parsed.pathname;
      if (path === '/api/v1/conversations') {
        const eventId = parsed.searchParams.get('event_id');
        const items = [...convs.values()]
          .filter((c) => !eventId || c.event.id === eventId)
          .map(summaryOf);
        return Promise.resolve(jsonResponse(200, { items, next_cursor: null }));
      }
      const convMatch = /^\/api\/v1\/conversations\/([^/]+)(?:\/(messages|read))?$/.exec(path);
      const conv = convMatch?.[1] ? convs.get(convMatch[1]) : undefined;
      if (!convMatch || !conv) {
        return Promise.resolve(
          jsonResponse(404, { error: { code: 'CONVERSATION_NOT_FOUND', message: '' } }),
        );
      }
      if (convMatch[2] === 'read') {
        convs.set(conv.id, { ...conv, unread_count: 0 });
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (convMatch[2] === 'messages' && method === 'POST') {
        if (sendFails) {
          return Promise.resolve(jsonResponse(409, { error: { code: sendFails, message: '' } }));
        }
        const { body } = JSON.parse(init?.body as string) as { body: string };
        messageSeq += 1;
        const message: MessagePublic = {
          id: `sent-${String(messageSeq)}`,
          conversation_id: conv.id,
          sender_member_id: conv.my_member.id,
          body,
          deleted: false,
          created_at: new Date().toISOString(),
        };
        history.set(conv.id, [message, ...(history.get(conv.id) ?? [])]);
        convs.set(conv.id, { ...conv, last_message: message, last_message_at: message.created_at });
        return Promise.resolve(jsonResponse(201, message));
      }
      if (convMatch[2] === 'messages') {
        const all = history.get(conv.id) ?? [];
        const start = Number(parsed.searchParams.get('cursor') ?? 0);
        const items = all.slice(start, start + messagePageSize);
        const next = start + messagePageSize < all.length ? String(start + messagePageSize) : null;
        return Promise.resolve(jsonResponse(200, { items, next_cursor: next }));
      }
      return Promise.resolve(jsonResponse(200, convs.get(conv.id)));
    }
    const deleteMessageMatch = /^\/api\/v1\/messages\/([^/?]+)$/.exec(url);
    if (deleteMessageMatch?.[1] && method === 'DELETE') {
      for (const [id, list] of history) {
        history.set(
          id,
          list.map((m) =>
            m.id === deleteMessageMatch[1] ? { ...m, body: null, deleted: true } : m,
          ),
        );
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    const startMatch = /^\/api\/v1\/events\/([^/?]+)\/conversations$/.exec(url);
    if (startMatch?.[1] && method === 'POST' && me) {
      const eventId = startMatch[1];
      const { kind, recipient_id: recipientId } = JSON.parse(init?.body as string) as {
        kind: 'direct' | 'anonymous';
        recipient_id: string;
      };
      const existing = [...convs.values()].find(
        (c) =>
          c.event.id === eventId && c.kind === kind && c.title_member?.id === `mem-${recipientId}`,
      );
      if (existing) return Promise.resolve(jsonResponse(200, existing));
      const event = details.get(eventId);
      const person = (rosters.get(eventId) ?? []).find((p) => p.user_id === recipientId);
      convSeq += 1;
      const mine: MemberPublic = {
        id: `mem-me-${String(convSeq)}`,
        display_name: kind === 'anonymous' ? 'Secret Elf #7' : me.name,
        avatar_url: kind === 'anonymous' ? null : me.avatar_url,
        is_self: true,
        is_anonymous: kind === 'anonymous',
        anon_number: kind === 'anonymous' ? 7 : null,
        is_former: false,
        is_deleted: false,
      };
      const other: MemberPublic = {
        id: `mem-${recipientId}`,
        display_name: person?.name ?? recipientId,
        avatar_url: person?.avatar_url ?? null,
        is_self: false,
        is_anonymous: false,
        anon_number: null,
        is_former: false,
        is_deleted: false,
      };
      const created: ConversationDetail = {
        id: `conv-new-${String(convSeq)}`,
        event: { id: eventId, name: event?.name ?? 'Evento', state: event?.state ?? 'open' },
        kind,
        title_member: other,
        my_member: mine,
        last_message: null,
        last_message_at: null,
        unread_count: 0,
        members: [mine, other],
      };
      convs.set(created.id, created);
      return Promise.resolve(jsonResponse(201, created));
    }
    const photoMatch = /^\/api\/v1\/wishlist\/items\/([^/?]+)\/photos(?:\/([^/?]+))?$/.exec(url);
    if (photoMatch?.[1] && me) {
      const mine = lists.get(me.id);
      const item = mine?.items.find((i) => i.id === photoMatch[1]);
      if (!mine || !item) {
        return Promise.resolve(
          jsonResponse(404, { error: { code: 'WISHLIST_ITEM_NOT_FOUND', message: '' } }),
        );
      }
      let updated: WishlistItem;
      if (method === 'POST') {
        const file = (init?.body as FormData).get('file') as File;
        const custom = photoUpload?.(item.id, file);
        if (custom) return Promise.resolve(custom); // may be a promise the test settles
        photoSeq += 1;
        const n = String(photoSeq);
        updated = {
          ...item,
          photos: [
            ...item.photos,
            {
              id: `photo-${n}`,
              url: `https://storage.test/p${n}.webp`,
              thumb_url: `https://storage.test/p${n}_thumb.webp`,
              width: 1600,
              height: 1200,
            },
          ],
        };
      } else {
        updated = { ...item, photos: item.photos.filter((p) => p.id !== photoMatch[2]) };
      }
      lists.set(me.id, {
        ...mine,
        items: mine.items.map((i) => (i.id === item.id ? updated : i)),
      });
      return Promise.resolve(
        method === 'POST' ? jsonResponse(201, updated) : new Response(null, { status: 204 }),
      );
    }
    const copyMatch =
      /^\/api\/v1\/events\/([^/?]+)\/wishlist\/(copy-sources|copy-from\/([^/?]+))$/.exec(url);
    if (copyMatch?.[1] && me) {
      if (copyMatch[2] === 'copy-sources') {
        return Promise.resolve(jsonResponse(200, copySources[copyMatch[1]] ?? []));
      }
      const mine = lists.get(me.id) ?? {
        owner: { id: me.id, name: me.name, avatar_url: me.avatar_url },
        is_self: true,
        items: [],
      };
      const copies = (copyItems[copyMatch[3] ?? ''] ?? []).map((item, i) => ({
        ...item,
        id: `copy-${String(i + 1)}-${item.id}`,
        position: mine.items.length + i,
      }));
      lists.set(me.id, { ...mine, items: [...mine.items, ...copies] });
      return Promise.resolve(jsonResponse(201, copies));
    }
    const coverMatch = /^\/api\/v1\/events\/([^/?]+)\/cover$/.exec(url);
    if (coverMatch?.[1]) {
      const event = details.get(coverMatch[1]);
      if (!event) return Promise.resolve(jsonResponse(404, { error: { code: 'EVENT_NOT_FOUND' } }));
      if (method === 'POST') {
        const file = (init?.body as FormData).get('file') as File;
        const custom = coverUpload?.(event.id, file);
        if (custom) return Promise.resolve(custom);
        covers += 1;
        const updated = {
          ...event,
          cover_url: `https://storage.test/cover-${String(covers)}.webp`,
          cover_thumb_url: `https://storage.test/cover-${String(covers)}_thumb.webp`,
        };
        details.set(event.id, updated);
        return Promise.resolve(jsonResponse(200, updated));
      }
      const cleared = { ...event, cover_url: null, cover_thumb_url: null };
      details.set(event.id, cleared);
      return Promise.resolve(jsonResponse(200, cleared));
    }
    const drawMatch = /^\/api\/v1\/events\/([^/?]+)\/draw$/.exec(url);
    if (drawMatch?.[1] && method === 'POST') {
      const event = details.get(drawMatch[1]);
      if (!event) return Promise.resolve(jsonResponse(404, { error: { code: 'EVENT_NOT_FOUND' } }));
      const after = onDraw ? onDraw(event) : { ...event, state: 'drawn' as const };
      if (after instanceof Response) return Promise.resolve(after);
      details.set(event.id, after);
      return Promise.resolve(jsonResponse(200, { state: 'drawn' }));
    }
    const archiveMatch = /^\/api\/v1\/events\/([^/?]+)\/archive$/.exec(url);
    if (archiveMatch?.[1] && method === 'POST') {
      const event = details.get(archiveMatch[1]);
      if (!event) return Promise.resolve(jsonResponse(404, { error: { code: 'EVENT_NOT_FOUND' } }));
      const after = onArchive
        ? onArchive(event)
        : { ...event, state: 'archived' as const, archived_at: new Date().toISOString() };
      if (after instanceof Response) return Promise.resolve(after);
      details.set(event.id, after);
      return Promise.resolve(jsonResponse(200, after));
    }
    const exclusionMatch = /^\/api\/v1\/events\/([^/?]+)\/exclusions(?:\/([^/?]+))?$/.exec(url);
    if (exclusionMatch?.[1]) {
      const id = exclusionMatch[1];
      const event = details.get(id);
      if (!event) return Promise.resolve(jsonResponse(404, { error: { code: 'EVENT_NOT_FOUND' } }));
      if (event.my_role !== 'host') {
        return Promise.resolve(jsonResponse(403, { error: { code: 'HOST_ONLY', message: '' } }));
      }
      const current = exclusionLists.get(id) ?? { items: [], feasible: true };
      const save = (items: Exclusion[], status: number) => {
        const list = { items, feasible: exclusionsFeasible(items) };
        exclusionLists.set(id, list);
        return Promise.resolve(jsonResponse(status, list));
      };
      if (method === 'POST') {
        const { user_ids: ids } = JSON.parse(init?.body as string) as { user_ids: string[] };
        const people = new Map((rosters.get(id) ?? []).map((p) => [p.user_id, p]));
        const pub = (userId: string) => {
          const p = people.get(userId);
          return { id: userId, name: p?.name ?? userId, avatar_url: p?.avatar_url ?? null };
        };
        const items = [...current.items];
        ids.forEach((x, i) => {
          ids.slice(i + 1).forEach((y) => {
            const [a, b] = [x, y].sort() as [string, string];
            if (!items.some((e) => e.user_a.id === a && e.user_b.id === b)) {
              items.push({ id: `x-${a}-${b}`, user_a: pub(a), user_b: pub(b) });
            }
          });
        });
        return save(items, 201);
      }
      if (method === 'DELETE') {
        return save(
          current.items.filter((e) => e.id !== exclusionMatch[2]),
          200,
        );
      }
      return Promise.resolve(jsonResponse(200, current));
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
    if (url.startsWith('/api/v1/push/') && me) {
      if (url === '/api/v1/push/vapid-public-key') {
        return Promise.resolve(
          vapidKey
            ? jsonResponse(200, { public_key: vapidKey })
            : jsonResponse(503, { error: { code: 'PUSH_NOT_CONFIGURED', message: '' } }),
        );
      }
      if (url === '/api/v1/push/test' && method === 'POST') {
        return Promise.resolve(new Response(null, { status: 202 }));
      }
      if (url === '/api/v1/push/subscriptions' && method === 'POST') {
        const { endpoint } = JSON.parse(init?.body as string) as { endpoint: string };
        const id = deviceByEndpoint.get(endpoint) ?? `device-${String(deviceByEndpoint.size + 1)}`;
        deviceByEndpoint.set(endpoint, id);
        const device = pushDevice({ id, created_at: '2026-09-24T12:00:00Z' });
        myDevices.set(id, device);
        return Promise.resolve(jsonResponse(201, device));
      }
      if (url === '/api/v1/push/subscriptions') {
        return Promise.resolve(jsonResponse(200, [...myDevices.values()].reverse()));
      }
      const removeMatch = /^\/api\/v1\/push\/subscriptions\/([^/?]+)$/.exec(url);
      if (removeMatch?.[1] && method === 'DELETE') {
        if (!myDevices.delete(removeMatch[1])) {
          return Promise.resolve(
            jsonResponse(404, { error: { code: 'PUSH_SUBSCRIPTION_NOT_FOUND', message: '' } }),
          );
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      }
    }
    if (url === '/api/v1/auth/logout') return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: '' } }));
  });
  const calls = () =>
    spy.mock.calls.map(([input, init]) => `${init?.method ?? 'GET'} ${urlOf(input)}`);
  const initOf = (path: string) => spy.mock.calls.find(([input]) => urlOf(input) === path)?.[1];
  return { spy, calls, initOf };
}

/**
 * XMLHttpRequest stand-in (uploads use XHR for progress): replays the request through
 * `globalThis.fetch`, so the same `mockSession` spy answers it, and reports 50% then 100%.
 */
export class FakeXhr {
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  withCredentials = false;
  status = 0;
  responseText = '';
  private method = 'GET';
  private url = '';
  private headers: Record<string, string> = {};
  private responseHeaders: Headers | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  getResponseHeader(name: string): string | null {
    return this.responseHeaders?.get(name) ?? null;
  }

  abort() {
    this.onabort?.();
  }

  send(body: XMLHttpRequestBodyInit | null) {
    const progress = (loaded: number) => {
      this.upload.onprogress?.({ lengthComputable: true, loaded, total: 100 } as ProgressEvent);
    };
    progress(50);
    globalThis
      .fetch(this.url, {
        method: this.method,
        headers: this.headers,
        body,
        credentials: this.withCredentials ? 'include' : 'same-origin',
      })
      .then(async (response) => {
        this.status = response.status;
        this.responseText = await response.text();
        this.responseHeaders = response.headers;
        progress(100);
        this.onload?.();
      })
      .catch(() => {
        this.onerror?.();
      });
  }
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
    cover_url: null,
    cover_thumb_url: null,
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
    cover_url: null,
    cover_thumb_url: null,
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

/** A conversation member (the API's MemberPublic). */
export function member(overrides: Partial<MemberPublic> = {}): MemberPublic {
  return {
    id: 'mem-beto',
    display_name: 'Beto Solís',
    avatar_url: null,
    is_self: false,
    is_anonymous: false,
    anon_number: null,
    is_former: false,
    is_deleted: false,
    ...overrides,
  };
}

export const MY_MEMBER = member({
  id: 'mem-me',
  display_name: TEST_USER.name,
  avatar_url: TEST_USER.avatar_url,
  is_self: true,
});

export function conversation(overrides: Partial<ConversationDetail> = {}): ConversationDetail {
  const mine = overrides.my_member ?? MY_MEMBER;
  const other = overrides.title_member === undefined ? member() : overrides.title_member;
  return {
    id: 'conv-1',
    event: { id: eventDetail().id, name: 'Oficina 2026', state: 'open' },
    kind: 'direct',
    title_member: other,
    my_member: mine,
    last_message: null,
    last_message_at: null,
    unread_count: 0,
    members: other ? [mine, other] : [mine],
    ...overrides,
  };
}

export function message(overrides: Partial<MessagePublic> = {}): MessagePublic {
  return {
    id: 'msg-1',
    conversation_id: 'conv-1',
    sender_member_id: 'mem-beto',
    body: 'Hola',
    deleted: false,
    created_at: '2026-09-24T12:00:00Z',
    ...overrides,
  };
}
