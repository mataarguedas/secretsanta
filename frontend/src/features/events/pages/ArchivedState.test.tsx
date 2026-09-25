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

/** Prompt 27: archiving, and the read-only archived event (CLAUDE.md §2.6). */

const ROSTER = [
  participant({
    user_id: TEST_USER.id,
    name: 'Ana Rojas',
    avatar_url: TEST_USER.avatar_url,
    is_host: true,
    is_self: true,
  }),
  participant({ user_id: 'u-beto', name: 'Beto Solís' }),
  participant({ user_id: 'u-carla', name: 'Carla Mora' }),
];
const ASSIGNMENT = { receiver: { user_id: 'u-carla', name: 'Carla Mora', avatar_url: null } };
const PAST = '2026-01-10T19:00:00-06:00';
const FUTURE = '2999-12-20T19:00:00-06:00';

const drawn = (overrides: Partial<EventDetail> = {}) =>
  eventDetail({
    state: 'drawn',
    drawn_at: '2026-01-01T12:00:00Z',
    exchange_at: PAST,
    my_assignment: ASSIGNMENT,
    draw_readiness: { participant_count: 3, feasible: true, can_draw: false },
    ...overrides,
  });
const archived = (overrides: Partial<EventDetail> = {}) =>
  drawn({ state: 'archived', archived_at: '2026-01-11T12:00:00Z', ...overrides });

async function open(
  event: EventDetail,
  path: string,
  extra: Partial<Parameters<typeof mockSession>[0]> = {},
) {
  const session = mockSession({
    me: TEST_USER,
    eventDetails: { [event.id]: event },
    participants: { [event.id]: ROSTER },
    ...extra,
  });
  const utils = renderApp(path);
  await screen.findByRole('heading', { level: 1 });
  return { ...utils, ...session };
}

describe('Archive event (Manage)', () => {
  it('the host archives a drawn event after the exchange, behind a confirm', async () => {
    const user = userEvent.setup();
    const { calls } = await open(drawn(), '/events/e1/manage');

    const section = screen.getByRole('region', { name: 'Archivar evento' });
    await user.click(within(section).getByRole('button', { name: 'Archivar evento' }));
    const dialog = screen.getByRole('dialog', { name: '¿Archivar “Familia”?' });
    await user.click(within(dialog).getByRole('button', { name: 'Sí, archivar' }));

    await waitFor(() => {
      expect(screen.getByText('Archivado')).toBeInTheDocument();
    });
    expect(calls()).toContain('POST /api/v1/events/e1/archive');
    expect(await screen.findByText('Evento archivado.')).toBeInTheDocument();
    // Now read-only: the note, and neither the archive nor the edit section.
    expect(screen.getByRole('region', { name: 'Este evento está archivado' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Archivar evento' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
  });

  it('cancelling sends nothing', async () => {
    const user = userEvent.setup();
    const { calls } = await open(drawn(), '/events/e1/manage');
    await user.click(screen.getByRole('button', { name: 'Archivar evento' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls()).not.toContain('POST /api/v1/events/e1/archive');
  });

  it('a refusal is shown as a translated error', async () => {
    const user = userEvent.setup();
    await open(drawn(), '/events/e1/manage', {
      onArchive: () => jsonResponse(409, { error: { code: 'ARCHIVE_TOO_EARLY', message: '' } }),
    });
    await user.click(screen.getByRole('button', { name: 'Archivar evento' }));
    await user.click(screen.getByRole('button', { name: 'Sí, archivar' }));
    expect(
      await screen.findByText(
        'Un evento solo se puede archivar después de la fecha del intercambio.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Sorteado')).toBeInTheDocument();
  });

  it.each([
    ['drawn, before the exchange', drawn({ exchange_at: FUTURE })],
    ['open, even after the exchange', eventDetail({ state: 'open', exchange_at: PAST })],
    ['already archived', archived()],
  ])('no Archive button when %s', async (_case, event) => {
    await open(event, '/events/e1/manage');
    expect(screen.queryByRole('button', { name: 'Archivar evento' })).not.toBeInTheDocument();
  });
});

describe('Archived event', () => {
  it('header shows the ARCHIVED eyebrow', async () => {
    await open(archived(), '/events/e1');
    expect(screen.getByText('Archivado')).toBeInTheDocument();
  });

  it('Manage: a read-only note and no edit controls at all', async () => {
    const { container } = await open(archived(), '/events/e1/manage');

    const note = screen.getByRole('region', { name: 'Este evento está archivado' });
    expect(note).toHaveTextContent('Todo aquí es de solo lectura.');
    expect(screen.queryByRole('region', { name: 'Editar evento' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Eliminar evento' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Foto de portada' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    const exclusions = screen.getByRole('region', { name: 'Exclusiones' });
    await within(exclusions).findByText('Las exclusiones quedan bloqueadas después del sorteo.');
    expect(within(exclusions).queryByRole('button')).toBeNull();
    const invite = screen.getByRole('region', { name: 'Enlace de invitación' });
    expect(within(invite).queryByRole('button')).toBeNull();
    // Nothing in the whole tab is actionable.
    expect(within(screen.getByRole('tabpanel')).queryAllByRole('button')).toHaveLength(0);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Overview: "You\'re giving to…" is still there, no Leave', async () => {
    const { draw_readiness: _hostOnly, ...rest } = archived({
      my_role: 'participant',
      invite_token: null,
      host: { id: 'u-ana', name: 'Ana Rojas', avatar_url: null },
    });
    const guest: EventDetail = rest;
    const { container } = await open(guest, '/events/e1');
    const card = screen.getByRole('region', { name: 'Le regalas a…' });
    expect(card).toHaveTextContent('Carla Mora');
    expect(screen.queryByRole('button', { name: 'Salir del evento' })).not.toBeInTheDocument();
    expect(screen.getByText('Archivado')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Participants: no Remove buttons', async () => {
    await open(archived(), '/events/e1/participants');
    const list = await screen.findByRole('list', { name: 'Participantes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /^Quitar/ })).not.toBeInTheDocument();
  });
});
