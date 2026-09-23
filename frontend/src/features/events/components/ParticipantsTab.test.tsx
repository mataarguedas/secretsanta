import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import type { EventDetail, Participant } from '@/features/events/api';
import { eventDetail, mockSession, participant, renderApp, TEST_USER } from '@/test/render';

const ANA = participant({
  user_id: TEST_USER.id,
  name: 'Ana Rojas',
  avatar_url: TEST_USER.avatar_url,
  is_host: true,
  is_self: true,
});
const BETO = participant({ user_id: 'u-beto', name: 'Beto Solís' });
const CARLA = participant({ user_id: 'u-carla', name: 'Carla Mora' });

const hostEvent = (overrides: Partial<EventDetail> = {}) =>
  eventDetail({ participant_count: 3, ...overrides });

/** Beto's view: Ana hosts, Beto is "you". */
const guestEvent = (overrides: Partial<EventDetail> = {}) =>
  eventDetail({
    participant_count: 3,
    my_role: 'participant',
    host: { id: ANA.user_id, name: ANA.name, avatar_url: ANA.avatar_url },
    ...overrides,
  });
const guestRoster: Participant[] = [{ ...ANA, is_self: false }, { ...BETO, is_self: true }, CARLA];

async function renderTab(event: EventDetail, roster: Participant[], path = 'participants') {
  const session = mockSession({
    me: TEST_USER,
    eventDetails: { [event.id]: event },
    participants: { [event.id]: roster },
  });
  const utils = renderApp(path ? `/events/${event.id}/${path}` : `/events/${event.id}`);
  await screen.findByRole('heading', { level: 1 });
  return { ...session, ...utils };
}

function at(items: HTMLElement[], index: number): HTMLElement {
  const item = items[index];
  if (!item) throw new Error(`no row ${String(index)}`);
  return item;
}

const rows = async () =>
  within(await screen.findByRole('list', { name: 'Participantes' })).getAllByRole('listitem');

describe('Participants tab', () => {
  it('lists avatars and names, host first with a HOST eyebrow, and marks you', async () => {
    await renderTab(guestEvent(), guestRoster);
    const items = await rows();
    expect(items).toHaveLength(3);
    expect(within(at(items, 0)).getByText('Organiza')).toHaveClass('font-mono', 'uppercase');
    expect(within(at(items, 0)).getByRole('img', { name: 'Ana Rojas' })).toBeInTheDocument();
    expect(items[1]).toHaveTextContent('Beto Solís (tú)');
    expect(within(at(items, 2)).queryByText('(tú)')).toBeNull();
  });

  it('non-hosts see no Remove controls', async () => {
    await renderTab(guestEvent(), guestRoster);
    await rows();
    expect(screen.queryByRole('button', { name: /^Quitar/ })).not.toBeInTheDocument();
  });

  it('host (OPEN): a Remove ghost pill on every other row', async () => {
    await renderTab(hostEvent(), [ANA, BETO, CARLA]);
    const items = await rows();
    expect(within(at(items, 0)).queryByRole('button')).toBeNull();
    const remove = within(at(items, 1)).getByRole('button', {
      name: 'Quitar a Beto Solís',
    });
    expect(remove).toHaveTextContent('Quitar');
    expect(remove).toHaveClass('rounded-full-2');
    expect(remove).not.toHaveClass('bg-coral-pop');
    expect(screen.getAllByRole('button', { name: /^Quitar a/ })).toHaveLength(2);
  });

  it.each(['drawn', 'archived'] as const)('host (%s): the roster is frozen', async (state) => {
    await renderTab(hostEvent({ state }), [ANA, BETO, CARLA]);
    await rows();
    expect(screen.queryByRole('button', { name: /^Quitar/ })).not.toBeInTheDocument();
  });

  it('Remove confirms, deletes and refreshes the roster and the header count', async () => {
    const user = userEvent.setup();
    const { spy } = await renderTab(hostEvent(), [ANA, BETO, CARLA]);
    await rows();
    await user.click(screen.getByRole('button', { name: 'Quitar a Carla Mora' }));
    const dialog = screen.getByRole('dialog', { name: '¿Quitar a Carla Mora?' });
    expect(dialog).toHaveTextContent('Perderá acceso al evento.');

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(spy.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Quitar a Carla Mora' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, quitar' }),
    );

    expect(await screen.findByText('Carla Mora ya no participa.')).toBeInTheDocument();
    await waitFor(async () => {
      expect(await rows()).toHaveLength(2);
    });
    const del = spy.mock.calls.find(([, init]) => init?.method === 'DELETE');
    expect(del?.[0]).toBe('/api/v1/events/e1/participants/u-carla');
    // The event (and its header/overview count) was refetched after the removal.
    await waitFor(() => {
      const gets = spy.mock.calls.filter(
        ([url, init]) => url === '/api/v1/events/e1' && init?.method === 'GET',
      );
      expect(gets.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('has no axe violations', async () => {
    const { container } = await renderTab(hostEvent(), [ANA, BETO, CARLA]);
    await rows();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Leave event (Overview)', () => {
  it('non-host in an OPEN event: a secondary pill that confirms, leaves and goes home', async () => {
    const user = userEvent.setup();
    const { spy, router } = await renderTab(guestEvent(), guestRoster, '');
    const leave = screen.getByRole('button', { name: 'Salir del evento' });
    expect(leave).toHaveClass('border-terracotta-whisper', 'rounded-full-2');

    await user.click(leave);
    const dialog = screen.getByRole('dialog', { name: '¿Salir de «Familia»?' });
    await user.click(within(dialog).getByRole('button', { name: 'Sí, salir' }));

    expect(await screen.findByText('Saliste de «Familia».')).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    const post = spy.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[0]).toBe('/api/v1/events/e1/leave');
  });

  it.each([
    ['the host', hostEvent()],
    ['a drawn event', guestEvent({ state: 'drawn' })],
    ['an archived event', guestEvent({ state: 'archived' })],
  ])('is not offered to %s', async (_case, event) => {
    await renderTab(event, guestRoster, '');
    expect(screen.queryByRole('button', { name: 'Salir del evento' })).not.toBeInTheDocument();
  });
});
