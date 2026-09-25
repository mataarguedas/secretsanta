import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import type { EventDetail } from '@/features/events/api';
import type { Wishlist } from '@/features/wishlist/api';
import i18n from '@/i18n';
import {
  conversation,
  eventDetail,
  member,
  mockSession,
  participant,
  renderApp,
  TEST_USER,
} from '@/test/render';

/**
 * Prompt 30: an axe check on every tab of the event page (Overview open and drawn,
 * Participants, Wishlists, Chat, Manage), in both languages.
 */

const ANA = participant({
  user_id: TEST_USER.id,
  name: TEST_USER.name,
  avatar_url: TEST_USER.avatar_url,
  is_host: true,
  is_self: true,
});
const BETO = participant({ user_id: 'u-beto', name: 'Beto Solís' });
const CARLA = participant({ user_id: 'u-carla', name: 'Carla Mora' });

const MINE: Wishlist = {
  owner: { id: ANA.user_id, name: ANA.name, avatar_url: ANA.avatar_url },
  is_self: true,
  items: [
    {
      id: 'i1',
      title: 'Audífonos',
      note: 'Inalámbricos',
      url: 'https://tienda.example/audifonos',
      price_crc: 30000,
      priority: 'high',
      position: 0,
      photos: [],
    },
  ],
};

const OPEN = eventDetail();
const DRAWN: EventDetail = eventDetail({
  state: 'drawn',
  drawn_at: '2026-10-01T12:00:00Z',
  my_assignment: { receiver: { user_id: BETO.user_id, name: BETO.name, avatar_url: null } },
});

async function renderAt(path: string, event: EventDetail, ready: string, lng: 'es' | 'en') {
  mockSession({
    // The saved locale wins after sign-in (useSyncLocale).
    me: { ...TEST_USER, locale: lng },
    eventDetails: { [event.id]: event },
    participants: { [event.id]: [ANA, BETO, CARLA] },
    wishlists: { [ANA.user_id]: MINE },
    conversations: [
      conversation({
        kind: 'anonymous',
        title_member: member({ display_name: 'Beto Solís' }),
        my_member: member({
          id: 'mem-me',
          display_name: 'Secret Elf #4',
          is_self: true,
          is_anonymous: true,
          anon_number: 4,
        }),
      }),
    ],
  });
  const utils = renderApp(path);
  await screen.findByRole('heading', { level: 1 });
  // The tab's own content, not its loading state.
  expect((await screen.findAllByText(ready)).length).toBeGreaterThan(0);
  return utils;
}

describe.each(['es', 'en'] as const)('event tabs (%s)', (lng) => {
  it.each([
    ['overview (open)', '/events/e1', OPEN, (): string => 'Heredia'],
    ['overview (drawn)', '/events/e1', DRAWN, (): string => i18n.t('draw.givingTo.title')],
    ['participants', '/events/e1/participants', OPEN, (): string => 'Carla Mora'],
    ['wishlists', '/events/e1/wishlists', OPEN, (): string => 'Audífonos'],
    ['chat', '/events/e1/chat', OPEN, (): string => 'Beto Solís'],
    ['manage', '/events/e1/manage', OPEN, (): string => i18n.t('exclusions.feasible')],
    ['manage (drawn)', '/events/e1/manage', DRAWN, (): string => i18n.t('draw.reveal.doneTitle')],
  ] as const)('%s has no axe violations', async (_name, path, event, ready) => {
    await i18n.changeLanguage(lng);
    const { container } = await renderAt(path, event, ready(), lng);
    expect(await axe(container)).toHaveNoViolations();
  });
});
