import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import type { EventDetail } from '@/features/events/api';
import {
  conversation,
  eventDetail,
  mockSession,
  participant,
  renderApp,
  TEST_USER,
} from '@/test/render';

const ANA = participant({ user_id: TEST_USER.id, name: 'Ana Rojas', is_self: true, is_host: true });
const BETO = participant({ user_id: 'u-beto', name: 'Beto Solís' });
const CARLA = participant({ user_id: 'u-carla', name: 'Carla Mora' });

async function renderTab(event: EventDetail = eventDetail(), existing = true) {
  const session = mockSession({
    me: TEST_USER,
    eventDetails: { [event.id]: event },
    participants: { [event.id]: [ANA, BETO, CARLA] },
    conversations: existing
      ? [
          conversation({
            id: 'direct',
            event: { id: event.id, name: event.name, state: event.state },
          }),
          conversation({
            id: 'group',
            kind: 'group',
            title_member: null,
            event: { id: event.id, name: event.name, state: event.state },
          }),
        ]
      : [],
  });
  const utils = renderApp(`/events/${event.id}/chat`);
  await screen.findByRole('heading', { level: 2, name: 'Conversaciones' });
  return { ...session, ...utils };
}

describe('Event › Chat tab', () => {
  it("lists this event's conversations, the group first", async () => {
    await renderTab();
    const section = screen.getByRole('region', { name: 'Conversaciones' });
    await within(section).findByRole('link', { name: /Chat grupal/ });
    expect(
      within(section)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/chats/group', '/chats/direct']);
  });

  it('empty state without a group chat', async () => {
    await renderTab(eventDetail(), false);
    expect(await screen.findByText('Todavía no hay conversaciones')).toHaveClass('font-serif');
  });

  it('New conversation: pick someone (never me), Anonymous, Start → the thread opens', async () => {
    const user = userEvent.setup();
    const { router, calls } = await renderTab();
    await user.click(screen.getByRole('button', { name: 'Nueva conversación' }));
    const sheet = screen.getByRole('dialog', { name: 'Nueva conversación' });

    const people = within(within(sheet).getByRole('group', { name: '¿Con quién?' })).getAllByRole(
      'button',
    );
    people.forEach((button, i) => {
      expect(button).toHaveAccessibleName(['Beto Solís', 'Carla Mora'][i]);
    });
    expect(people).toHaveLength(2);
    const start = within(sheet).getByRole('button', { name: 'Empezar' });
    expect(start).toBeDisabled();
    expect(start).toHaveClass('bg-coral-pop');

    const modes = within(sheet).getByRole('group', { name: '¿Cómo quieres aparecer?' });
    expect(within(modes).getByRole('button', { name: 'Con mi nombre' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(modes).getByRole('button', { name: 'Anónimo' }));
    expect(within(sheet).getByText(/Te verán como un elfo secreto/)).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Beto Solís' }));
    expect(await axe(sheet)).toHaveNoViolations();
    await user.click(start);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/chats/conv-new-1');
    });
    expect(calls()).toContain(`POST /api/v1/events/${eventDetail().id}/conversations`);
    expect(
      await screen.findByText('Eres anónimo: te ven como Elfo secreto #7.'),
    ).toBeInTheDocument();
  });

  it('starting again with the same person and mode opens the same thread', async () => {
    const user = userEvent.setup();
    const { router } = await renderTab();
    for (let n = 0; n < 2; n += 1) {
      await user.click(await screen.findByRole('button', { name: 'Nueva conversación' }));
      const sheet = screen.getByRole('dialog', { name: 'Nueva conversación' });
      await user.click(within(sheet).getByRole('button', { name: 'Carla Mora' }));
      await user.click(within(sheet).getByRole('button', { name: 'Empezar' }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/chats/conv-new-1');
      });
      await router.navigate(`/events/${eventDetail().id}/chat`);
      await screen.findByRole('heading', { level: 2, name: 'Conversaciones' });
    }
  });

  it('archived events: read-only, no New conversation', async () => {
    await renderTab(eventDetail({ state: 'archived' }));
    expect(screen.queryByRole('button', { name: 'Nueva conversación' })).not.toBeInTheDocument();
    expect(
      screen.getByText('Este evento está archivado: los chats son de solo lectura.'),
    ).toBeInTheDocument();
  });
});
