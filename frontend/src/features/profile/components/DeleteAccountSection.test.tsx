import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { ME_QUERY_KEY } from '@/features/auth/api';
import type { DeletionPreview } from '@/features/profile/api';
import { jsonResponse, mockSession, renderApp, TEST_USER } from '@/test/render';

/** Prompt 28: Profile › Delete account (FR-ACC-3). */

const OK: DeletionPreview = { blocked: false, blocking_events: [], hosted_open_events: [] };

async function openDialog(options: Partial<Parameters<typeof mockSession>[0]> = {}) {
  const user = userEvent.setup();
  const session = mockSession({ me: TEST_USER, ...options });
  const utils = renderApp('/profile');
  await screen.findByRole('heading', { level: 1, name: TEST_USER.name });
  const section = screen.getByRole('region', { name: 'Eliminar cuenta' });
  await user.click(within(section).getByRole('button', { name: 'Eliminar cuenta' }));
  const dialog = screen.getByRole('dialog', { name: '¿Eliminar tu cuenta?' });
  return { user, dialog, ...session, ...utils };
}

describe('Delete account', () => {
  it('is a secondary pill at the bottom of Profile, never coral', async () => {
    mockSession({ me: TEST_USER });
    renderApp('/profile');
    await screen.findByRole('heading', { level: 1 });
    const button = screen.getByRole('button', { name: 'Eliminar cuenta' });
    expect(button.className).not.toMatch(/bg-coral-pop/);
    const headings = within(screen.getByRole('main')).getAllByRole('heading', { level: 2 });
    expect(headings.at(-1)).toHaveTextContent('Eliminar cuenta');
  });

  it('loads the preview only when opened', async () => {
    const { calls } = await openDialog();
    await waitFor(() => {
      expect(calls()).toContain('GET /api/v1/me/deletion-preview');
    });
    expect(calls().filter((c) => c === 'GET /api/v1/me/deletion-preview')).toHaveLength(1);
  });

  it('blocked: explains why, lists the drawn events and offers no delete action', async () => {
    const { dialog } = await openDialog({
      deletionPreview: {
        blocked: true,
        blocking_events: [{ id: 'e1', name: 'Oficina 2026' }],
        hosted_open_events: [],
      },
    });
    const list = await within(dialog).findByRole('list', { name: 'Eventos sorteados' });
    expect(within(list).getByText('Oficina 2026')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Todavía no puedes eliminar tu cuenta');
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).not.toContain('Eliminar mi cuenta');
    expect(within(dialog).getByRole('button', { name: 'Entendido' })).toBeInTheDocument();
    expect(await axe(dialog)).toHaveNoViolations();
  });

  it('lists the hosted open events that go too', async () => {
    const { dialog } = await openDialog({
      deletionPreview: {
        ...OK,
        hosted_open_events: [{ id: 'e2', name: 'Cena del barrio', participant_count: 4 }],
      },
    });
    const list = await within(dialog).findByRole('list', { name: 'Eventos que se eliminarán' });
    expect(list).toHaveTextContent('Cena del barrio');
    expect(list).toHaveTextContent('4 participantes');
  });

  it('no hosted events: no list', async () => {
    const { dialog } = await openDialog();
    await within(dialog).findByRole('textbox');
    expect(within(dialog).queryByRole('list')).not.toBeInTheDocument();
  });

  it('the delete button waits for the translated confirmation word', async () => {
    const { user, dialog, calls } = await openDialog();
    const input = await within(dialog).findByRole('textbox', {
      name: 'Escribe ELIMINAR para confirmar',
    });
    const confirm = within(dialog).getByRole('button', { name: 'Eliminar mi cuenta' });
    expect(confirm).toBeDisabled();
    await user.type(input, 'DELETE'); // the English word doesn't count in Spanish
    expect(confirm).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'eliminar');
    expect(confirm).toBeEnabled();
    expect(calls()).not.toContain('DELETE /api/v1/me');
  });

  it('on success: signed out, cache cleared, Landing and a toast', async () => {
    const { user, dialog, calls, queryClient, router } = await openDialog();
    await user.type(await within(dialog).findByRole('textbox'), 'ELIMINAR');
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar mi cuenta' }));

    expect(await screen.findByText('Tu cuenta se eliminó.')).toBeInTheDocument();
    expect(calls()).toContain('DELETE /api/v1/me');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    expect(queryClient.getQueryData(ME_QUERY_KEY)).toBeNull();
    // Nothing of the old account is left in the cache.
    const leftovers = queryClient
      .getQueryCache()
      .getAll()
      .filter((q) => q.queryKey[0] !== 'me' && q.state.data !== undefined);
    expect(leftovers.map((q) => q.queryKey)).toEqual([]);
    expect(await screen.findByRole('link', { name: 'Continuar con Google' })).toBeInTheDocument();
  });

  it('a refusal (the draw happened meanwhile) shows why and reloads the preview', async () => {
    let blocked = false;
    const { user, dialog, calls } = await openDialog({
      deleteMe: () => {
        blocked = true;
        return jsonResponse(409, { error: { code: 'ACCOUNT_IN_ACTIVE_DRAW', message: '' } });
      },
    });
    await user.type(await within(dialog).findByRole('textbox'), 'ELIMINAR');
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar mi cuenta' }));
    expect(
      await screen.findByText(
        'No puedes eliminar tu cuenta mientras estés en un evento que ya se sorteó.',
      ),
    ).toBeInTheDocument();
    expect(blocked).toBe(true);
    await waitFor(() => {
      expect(calls().filter((c) => c === 'GET /api/v1/me/deletion-preview')).toHaveLength(2);
    });
    expect(screen.getByRole('heading', { level: 1, name: TEST_USER.name })).toBeInTheDocument();
  });

  it('a failed preview offers a retry', async () => {
    const { dialog } = await openDialog({
      deletionPreview: jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: '' } }),
    });
    expect(await within(dialog).findByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('cancel closes without deleting', async () => {
    const { user, dialog, calls } = await openDialog();
    await within(dialog).findByRole('textbox');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls()).not.toContain('DELETE /api/v1/me');
  });
});
