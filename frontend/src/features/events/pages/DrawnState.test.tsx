import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import type { EventDetail } from '@/features/events/api';
import type { ExclusionList } from '@/features/exclusions/api';
import { eventDetail, mockSession, participant, renderApp, TEST_USER } from '@/test/render';

/** Prompt 17: after the draw every roster control is gone (CLAUDE.md §2.3). */

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
const EXCLUSIONS: ExclusionList = {
  items: [
    {
      id: 'x1',
      user_a: { id: BETO.user_id, name: BETO.name, avatar_url: null },
      user_b: { id: CARLA.user_id, name: CARLA.name, avatar_url: null },
    },
  ],
  feasible: true,
};
const ASSIGNMENT = { receiver: { user_id: 'u-carla', name: 'Carla Mora', avatar_url: null } };

const hostDrawn = eventDetail({
  state: 'drawn',
  participant_count: 3,
  my_assignment: ASSIGNMENT,
  draw_readiness: { participant_count: 3, feasible: true, can_draw: false },
});
const guestDrawn = eventDetail({
  state: 'drawn',
  participant_count: 3,
  my_role: 'participant',
  invite_token: null,
  host: { id: 'u-ana', name: 'Ana Rojas', avatar_url: null },
  my_assignment: ASSIGNMENT,
});

async function open(event: EventDetail, path: string) {
  mockSession({
    me: TEST_USER,
    eventDetails: { [event.id]: event },
    participants: { [event.id]: ROSTER },
    exclusions: { [event.id]: EXCLUSIONS },
  });
  const utils = renderApp(path);
  await screen.findByRole('heading', { level: 1 });
  return utils;
}

describe('Drawn event', () => {
  it('Manage: joining closed, exclusions read-only, "the draw is done", no Delete', async () => {
    const { container } = await open(hostDrawn, '/events/e1/manage');

    const invite = screen.getByRole('region', { name: 'Enlace de invitación' });
    expect(invite).toHaveTextContent('La inscripción está cerrada');
    expect(within(invite).queryByRole('button')).toBeNull();

    const exclusions = screen.getByRole('region', { name: 'Exclusiones' });
    expect(
      await within(exclusions).findByText('Las exclusiones quedan bloqueadas después del sorteo.'),
    ).toBeInTheDocument();
    expect(within(exclusions).queryByRole('button')).toBeNull();
    expect(within(exclusions).queryByRole('combobox')).toBeNull();

    expect(screen.getByRole('region', { name: 'El sorteo ya se hizo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revelar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Eliminar evento' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar evento' })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Participants: no Remove buttons for the host', async () => {
    await open(hostDrawn, '/events/e1/participants');
    const list = await screen.findByRole('list', { name: 'Participantes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /^Quitar/ })).not.toBeInTheDocument();
  });

  it('Overview: no Leave button for a participant, and the giving-to card instead', async () => {
    await open(guestDrawn, '/events/e1');
    expect(screen.getByRole('region', { name: 'Le regalas a…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salir del evento' })).not.toBeInTheDocument();
    expect(screen.getByText('Sorteado')).toBeInTheDocument();
  });
});
