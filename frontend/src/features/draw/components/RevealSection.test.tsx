import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import type { EventDetail } from '@/features/events/api';
import {
  eventDetail,
  jsonResponse,
  mockSession,
  participant,
  renderApp,
  TEST_USER,
} from '@/test/render';

const ANA = participant({
  user_id: TEST_USER.id,
  name: 'Ana Rojas',
  avatar_url: TEST_USER.avatar_url,
  is_host: true,
  is_self: true,
});
const BETO = participant({ user_id: 'u-beto', name: 'Beto Solís' });
const CARLA = participant({ user_id: 'u-carla', name: 'Carla Mora' });
const ROSTER = [ANA, BETO, CARLA];

const ready = (overrides: Partial<EventDetail> = {}) =>
  eventDetail({
    participant_count: 3,
    draw_readiness: { participant_count: 3, feasible: true, can_draw: true },
    ...overrides,
  });

async function renderManage(
  event: EventDetail,
  onDraw?: Parameters<typeof mockSession>[0]['onDraw'],
) {
  const session = mockSession({
    me: TEST_USER,
    eventDetails: { [event.id]: event },
    participants: { [event.id]: ROSTER },
    ...(onDraw ? { onDraw } : {}),
  });
  const utils = renderApp(`/events/${event.id}/manage`);
  const section = await screen.findByRole('region', { name: 'El sorteo' });
  return { ...session, ...utils, section };
}

const drawCalls = (spy: ReturnType<typeof mockSession>['spy']) =>
  spy.mock.calls.filter(
    ([url, init]) => url === '/api/v1/events/e1/draw' && init?.method === 'POST',
  );

describe('Manage › Reveal', () => {
  it('is the coral primary action when the draw can run', async () => {
    const { section } = await renderManage(ready());
    const reveal = within(section).getByRole('button', { name: 'Revelar' });
    expect(reveal).toBeEnabled();
    expect(reveal).toHaveClass('bg-coral-pop', 'rounded-full-2');
    expect(within(section).queryByText(/al menos 3/)).toBeNull();
  });

  it('is disabled with the "3 participants" reason', async () => {
    const { section } = await renderManage(
      ready({
        participant_count: 2,
        draw_readiness: { participant_count: 2, feasible: true, can_draw: false },
      }),
    );
    const reveal = within(section).getByRole('button', { name: 'Revelar' });
    expect(reveal).toBeDisabled();
    expect(reveal).toHaveAccessibleDescription(
      'Se necesitan al menos 3 participantes para revelar.',
    );
  });

  it('is disabled with the "impossible" reason when the exclusions block every draw', async () => {
    const { section } = await renderManage(
      ready({ draw_readiness: { participant_count: 3, feasible: false, can_draw: false } }),
    );
    const reveal = within(section).getByRole('button', { name: 'Revelar' });
    expect(reveal).toBeDisabled();
    expect(reveal).toHaveAccessibleDescription(
      'Las reglas de exclusión hacen imposible el sorteo.',
    );
  });

  it('once drawn, says the draw is done instead of offering it', async () => {
    mockSession({
      me: TEST_USER,
      eventDetails: { e1: ready({ state: 'drawn' }) },
      participants: { e1: ROSTER },
    });
    renderApp('/events/e1/manage');
    const done = await screen.findByRole('region', { name: 'El sorteo ya se hizo' });
    expect(done).toHaveTextContent(/el grupo ya no puede cambiar/);
    expect(screen.queryByRole('button', { name: 'Revelar' })).not.toBeInTheDocument();
  });

  it('confirms in a modal listing everyone, draws once and goes to Overview', async () => {
    const user = userEvent.setup();
    const { section, spy, router } = await renderManage(ready(), (event) => ({
      ...event,
      state: 'drawn',
      draw_readiness: { participant_count: 3, feasible: true, can_draw: false },
      my_assignment: { receiver: { user_id: 'u-carla', name: 'Carla Mora', avatar_url: null } },
    }));
    await user.click(within(section).getByRole('button', { name: 'Revelar' }));

    const dialog = screen.getByRole('dialog', { name: '¿Todo listo para el sorteo?' });
    expect(dialog).toHaveTextContent(
      'Después del sorteo nadie más puede unirse ni salir. No se puede deshacer.',
    );
    const list = await within(dialog).findByRole('list', { name: 'Participantes' });
    const people = within(list).getAllByRole('listitem');
    expect(people).toHaveLength(3);
    ['Ana Rojas (tú)', 'Beto Solís', 'Carla Mora'].forEach((name, index) => {
      expect(people[index]).toHaveTextContent(name);
    });

    // Cancel does nothing.
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(drawCalls(spy)).toHaveLength(0);

    await user.click(within(section).getByRole('button', { name: 'Revelar' }));
    const confirm = within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Todos están — revelar',
    });
    expect(confirm).toHaveClass('bg-coral-pop');
    await user.dblClick(confirm);

    expect(
      await screen.findByText('¡Sorteo hecho! Cada quien ya puede ver a quién le regala.'),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/events/e1');
    });
    expect(drawCalls(spy)).toHaveLength(1);
    expect(await screen.findByRole('region', { name: 'Le regalas a…' })).toBeInTheDocument();
    expect(screen.getByText('Sorteado')).toBeInTheDocument();
  });

  it('shows the server error and stays on Manage when the draw is refused', async () => {
    const user = userEvent.setup();
    const { section, router } = await renderManage(ready(), () =>
      jsonResponse(409, { error: { code: 'DRAW_INFEASIBLE', message: '' } }),
    );
    await user.click(within(section).getByRole('button', { name: 'Revelar' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Todos están — revelar' }),
    );
    expect(
      await screen.findByText('No hay un sorteo válido con estas reglas de exclusión.'),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/events/e1/manage');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has no axe violations (section and open modal)', async () => {
    const user = userEvent.setup();
    const { section, container } = await renderManage(ready());
    expect(await axe(container)).toHaveNoViolations();
    await user.click(within(section).getByRole('button', { name: 'Revelar' }));
    await within(screen.getByRole('dialog')).findByRole('list', { name: 'Participantes' });
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe('Overview › "You\'re giving to…"', () => {
  const drawn = (overrides: Partial<EventDetail> = {}) =>
    eventDetail({
      state: 'drawn',
      my_role: 'participant',
      invite_token: null,
      host: { id: 'u-host', name: 'Beto Solís', avatar_url: null },
      my_assignment: { receiver: { user_id: 'u-carla', name: 'Carla Mora', avatar_url: null } },
      ...overrides,
    });

  async function renderOverview(event: EventDetail) {
    mockSession({ me: TEST_USER, eventDetails: { [event.id]: event } });
    renderApp(`/events/${event.id}`);
    await screen.findByRole('heading', { level: 1 });
  }

  it('shows the coral header, the receiver in serif and a wishlist link', async () => {
    await renderOverview(drawn());
    const card = screen.getByRole('region', { name: 'Le regalas a…' });
    expect(within(card).getByRole('heading', { level: 2 }).closest('section')).toHaveClass(
      'bg-coral-pop',
    );
    expect(within(card).getByText('Carla Mora')).toHaveClass('font-serif', 'text-heading-lg');
    expect(within(card).getByRole('img', { name: 'Carla Mora' })).toBeInTheDocument();
    const link = within(card).getByRole('link', { name: 'Ver su lista de deseos' });
    expect(link).toHaveAttribute('href', '/events/e1/wishlists?user=u-carla');
    expect(link).toHaveClass('border-terracotta-whisper', 'rounded-full-2');
    expect(screen.getByText('Sorteado')).toHaveClass('font-mono', 'uppercase');
  });

  it('is the only coral Banner: no invite nudge once drawn, even for a lone host', async () => {
    await renderOverview(
      drawn({ my_role: 'host', participant_count: 1, invite_token: 'still-here' }),
    );
    expect(screen.queryByText('Invita a tus amigos')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.bg-coral-pop.min-h-\\[120px\\]')).toHaveLength(1);
  });

  it('is absent before the draw', async () => {
    await renderOverview(eventDetail({ my_assignment: null }));
    expect(screen.queryByRole('region', { name: 'Le regalas a…' })).not.toBeInTheDocument();
  });

  it('the wishlist link opens the Wishlists tab with ?user=', async () => {
    const user = userEvent.setup();
    mockSession({ me: TEST_USER, eventDetails: { e1: drawn() } });
    const { router } = renderApp('/events/e1');
    await user.click(await screen.findByRole('link', { name: 'Ver su lista de deseos' }));
    expect(router.state.location.pathname).toBe('/events/e1/wishlists');
    expect(router.state.location.search).toBe('?user=u-carla');
    expect(screen.getByRole('tab', { name: 'Listas de deseos' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
