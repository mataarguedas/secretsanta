import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import type { EventDetail } from '@/features/events/api';
import type { Exclusion, ExclusionList } from '@/features/exclusions/api';
import { eventDetail, mockSession, participant, renderApp, TEST_USER, urlOf } from '@/test/render';

const ANA = participant({
  user_id: 'u-ana',
  name: 'Ana Rojas',
  avatar_url: TEST_USER.avatar_url,
  is_host: true,
  is_self: true,
});
const BETO = participant({ user_id: 'u-beto', name: 'Beto Solís' });
const CARLA = participant({ user_id: 'u-carla', name: 'Carla Mora' });
const DANI = participant({ user_id: 'u-dani', name: 'Dani Vega' });
const ROSTER = [ANA, BETO, CARLA, DANI];

const pub = (p: typeof ANA) => ({ id: p.user_id, name: p.name, avatar_url: p.avatar_url });
const ANA_BETO: Exclusion = { id: 'x1', user_a: pub(ANA), user_b: pub(BETO) };

async function renderManage({
  event = eventDetail({ participant_count: 4 }),
  list = { items: [], feasible: true },
  feasible,
}: {
  event?: EventDetail;
  list?: ExclusionList;
  feasible?: (items: Exclusion[]) => boolean;
} = {}) {
  const session = mockSession({
    me: TEST_USER,
    eventDetails: { [event.id]: event },
    participants: { [event.id]: ROSTER },
    exclusions: { [event.id]: list },
    ...(feasible ? { exclusionsFeasible: feasible } : {}),
  });
  const utils = renderApp(`/events/${event.id}/manage`);
  const card = await screen.findByRole('region', { name: 'Exclusiones' });
  return { ...session, ...utils, card };
}

/** The feasibility line (the loading text is a status too). */
const status = (card: HTMLElement) =>
  waitFor(() => {
    const line = within(card).getByRole('status');
    expect(line).toHaveAttribute('data-feasible');
    return line;
  });
const pairRows = (card: HTMLElement) =>
  within(within(card).getByRole('list', { name: 'Parejas excluidas' })).getAllByRole('listitem');
const bodyOf = (spy: ReturnType<typeof mockSession>['spy'], method: string) => {
  const call = spy.mock.calls.find(
    ([url, init]) => urlOf(url).includes('/exclusions') && init?.method === method,
  );
  return call?.[1]?.body ? (JSON.parse(call[1].body as string) as unknown) : undefined;
};

describe('Manage › Exclusions', () => {
  it('lists pairs with avatars and a labelled remove pill, and says the draw is feasible', async () => {
    const { card } = await renderManage({ list: { items: [ANA_BETO], feasible: true } });
    const line = await status(card);
    expect(line).toHaveTextContent('Con estas reglas hay un sorteo válido.');
    expect(line).toHaveClass('text-success');
    expect(line).not.toHaveClass('bg-success');

    const [row] = pairRows(card);
    if (!row) throw new Error('no pair row');
    expect(row).toHaveTextContent(/Ana Rojas.*⟷.*Beto Solís/);
    // One avatar per person, decorative (the names are right beside them).
    expect(row.querySelectorAll('[aria-hidden="true"] .rounded-full-2')).toHaveLength(2);
    const remove = within(row).getByRole('button', {
      name: 'Quitar la exclusión entre Ana Rojas y Beto Solís',
    });
    expect(remove).toHaveClass('rounded-full-2');
  });

  it('shows the infeasible message as red status text', async () => {
    const { card } = await renderManage({ list: { items: [ANA_BETO], feasible: false } });
    const line = await status(card);
    expect(line).toHaveTextContent(
      'No hay un sorteo válido con estas reglas — quita algunas exclusiones.',
    );
    expect(line).toHaveClass('text-error');
  });

  it('shows an empty state with no pairs', async () => {
    const { card } = await renderManage();
    expect(
      await within(card).findByText(
        'Todavía no hay exclusiones: cualquiera puede sacar a cualquiera.',
      ),
    ).toBeInTheDocument();
  });

  it('Add pair: the same person cannot be picked twice, and it posts both ids', async () => {
    const user = userEvent.setup();
    const { card, spy } = await renderManage();
    const first = await within(card).findByLabelText('Primera persona');
    const second = within(card).getByLabelText('Segunda persona');
    const submit = within(card).getByRole('button', { name: 'Agregar pareja' });
    expect(submit).toBeDisabled();

    await user.selectOptions(first, 'u-beto');
    expect(within(second).queryByRole('option', { name: 'Beto Solís' })).toBeNull();
    expect(within(second).getByRole('option', { name: 'Ana Rojas (tú)' })).toBeInTheDocument();
    await user.selectOptions(second, 'u-carla');
    expect(within(first).queryByRole('option', { name: 'Carla Mora' })).toBeNull();

    await user.click(submit);
    expect(await screen.findByText('Pareja agregada.')).toBeInTheDocument();
    expect(bodyOf(spy, 'POST')).toEqual({ user_ids: ['u-beto', 'u-carla'] });
    await waitFor(() => {
      expect(pairRows(card)).toHaveLength(1);
    });
    expect(first).toHaveValue('');
    expect(second).toHaveValue('');
  });

  it('Group helper: needs 3 people, posts them all and updates the feasibility', async () => {
    const user = userEvent.setup();
    const { card, spy } = await renderManage({ feasible: (items) => items.length < 3 });
    const group = await within(card).findByRole('group', { name: 'Integrantes del grupo' });
    const create = within(card).getByRole('button', { name: 'Crear grupo' });

    for (const name of ['Beto Solís', 'Carla Mora']) {
      await user.click(within(group).getByRole('button', { name }));
    }
    expect(within(group).getByRole('button', { name: 'Beto Solís' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(create).toBeDisabled();
    expect(within(card).getByText('2 seleccionadas')).toBeInTheDocument();

    await user.click(within(group).getByRole('button', { name: 'Dani Vega' }));
    await user.click(create);

    expect(await screen.findByText('Grupo creado.')).toBeInTheDocument();
    expect(bodyOf(spy, 'POST')).toEqual({ user_ids: ['u-beto', 'u-carla', 'u-dani'] });
    await waitFor(() => {
      expect(pairRows(card)).toHaveLength(3);
    });
    expect(await status(card)).toHaveClass('text-error');
    // The selection resets.
    expect(within(group).getByRole('button', { name: 'Beto Solís' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('removes a pair and refreshes the event (draw readiness)', async () => {
    const user = userEvent.setup();
    const { card, spy } = await renderManage({ list: { items: [ANA_BETO], feasible: true } });
    await status(card);
    await user.click(
      within(card).getByRole('button', {
        name: 'Quitar la exclusión entre Ana Rojas y Beto Solís',
      }),
    );
    expect(await screen.findByText('Exclusión eliminada.')).toBeInTheDocument();
    const del = spy.mock.calls.find(([, init]) => init?.method === 'DELETE');
    expect(del?.[0]).toBe('/api/v1/events/e1/exclusions/x1');
    expect(
      await within(card).findByText(
        'Todavía no hay exclusiones: cualquiera puede sacar a cualquiera.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => {
      const gets = spy.mock.calls.filter(
        ([url, init]) => url === '/api/v1/events/e1' && init?.method === 'GET',
      );
      expect(gets.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('after the draw: read-only list with a locked note, no editors', async () => {
    const { card } = await renderManage({
      event: eventDetail({ participant_count: 4, state: 'drawn' }),
      list: { items: [ANA_BETO], feasible: true },
    });
    expect(
      await within(card).findByText('Las exclusiones quedan bloqueadas después del sorteo.'),
    ).toBeInTheDocument();
    expect(pairRows(card)).toHaveLength(1);
    expect(within(card).queryByRole('button')).toBeNull();
    expect(within(card).queryByLabelText('Primera persona')).toBeNull();
    expect(within(card).queryByRole('status')).toBeNull();
  });

  it('has no axe violations', async () => {
    const { card, container } = await renderManage({
      list: { items: [ANA_BETO], feasible: false },
    });
    await status(card);
    await within(card).findByRole('group', { name: 'Integrantes del grupo' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
