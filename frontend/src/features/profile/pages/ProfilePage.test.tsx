import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { ME_QUERY_KEY } from '@/features/auth/api';
import i18n from '@/i18n';
import { mockSession, renderApp, TEST_USER } from '@/test/render';

async function renderProfile(options: { patchError?: number } = {}) {
  const session = mockSession({ me: TEST_USER, ...options });
  const utils = renderApp('/profile');
  await screen.findByRole('heading', { level: 1, name: TEST_USER.name });
  return { ...session, ...utils };
}

const languageGroup = (name = 'Idioma') => screen.getByRole('group', { name });

describe('ProfilePage', () => {
  it('shows the identity: large avatar, serif name, read-only email', async () => {
    await renderProfile();
    const main = screen.getByRole('main');
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('font-serif');
    expect(within(main).getByRole('img', { name: TEST_USER.name })).toHaveAttribute(
      'src',
      TEST_USER.avatar_url,
    );
    expect(within(main).getByText(TEST_USER.email)).toBeInTheDocument();
    // The email is plain text; the only text field is the name.
    expect(within(main).getAllByRole('textbox')).toHaveLength(1);
    expect(within(main).getByRole('textbox', { name: 'Nombre que ven los demás' })).toHaveValue(
      TEST_USER.name,
    );
    expect(
      within(main).getByText(
        'Tu foto y correo vienen de tu cuenta de Google. Tu nombre empieza siendo el de Google y puedes cambiarlo.',
      ),
    ).toBeInTheDocument();
    expect(document.title).toBe('Secret Santa · Perfil');
  });

  it('shows every section in order, Delete account last', async () => {
    await renderProfile();
    const headings = within(screen.getByRole('main')).getAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual([
      'Nombre',
      'Idioma',
      'Notificaciones',
      'Dispositivos',
      'Legal',
      'Eliminar cuenta',
    ]);
  });

  it('links the privacy and terms pages', async () => {
    await renderProfile();
    const legal = screen.getByRole('region', { name: 'Legal' });
    expect(within(legal).getByRole('link', { name: 'Política de privacidad' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(within(legal).getByRole('link', { name: 'Términos del servicio' })).toHaveAttribute(
      'href',
      '/terms',
    );
  });

  it('language switch: PATCHes /me, switches instantly and toasts in the new language', async () => {
    const user = userEvent.setup();
    const { queryClient } = await renderProfile();
    const es = within(languageGroup()).getByRole('button', { name: 'Español' });
    expect(es).toHaveAttribute('aria-pressed', 'true');
    expect(es).toHaveAttribute('lang', 'es');

    await user.click(within(languageGroup()).getByRole('button', { name: 'English' }));

    // Instant: the UI, <html lang> and the tab title are English before the response lands.
    expect(i18n.language).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByRole('heading', { level: 2, name: 'Language' })).toBeInTheDocument();
    expect(
      within(languageGroup('Language')).getByRole('button', { name: 'English' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('Language updated.')).toBeInTheDocument();
    expect(document.title).toBe('Secret Santa · Profile');
    expect(screen.getByRole('navigation', { name: 'Navigation' })).toHaveTextContent('Profile');

    expect(queryClient.getQueryData(ME_QUERY_KEY)).toMatchObject({ locale: 'en' });
  });

  it('sends exactly { locale } with the CSRF header', async () => {
    const user = userEvent.setup();
    const { spy } = await renderProfile();
    await user.click(within(languageGroup()).getByRole('button', { name: 'English' }));
    await screen.findByText('Language updated.');
    const call = spy.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(call?.[0]).toBe('/api/v1/me');
    expect(call?.[1]?.body).toBe('{"locale":"en"}');
    expect((call?.[1]?.headers as Record<string, string>)['X-Requested-With']).toBe('fetch');
  });

  it('clicking the current language does nothing', async () => {
    const user = userEvent.setup();
    const { spy } = await renderProfile();
    await user.click(within(languageGroup()).getByRole('button', { name: 'Español' }));
    expect(spy.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('a failed save restores the previous language and says so', async () => {
    const user = userEvent.setup();
    const { queryClient } = await renderProfile({ patchError: 500 });
    await user.click(within(languageGroup()).getByRole('button', { name: 'English' }));

    expect(await screen.findByText('Algo salió mal. Inténtalo de nuevo.')).toBeInTheDocument();
    await waitFor(() => {
      expect(i18n.language).toBe('es');
    });
    expect(document.documentElement.lang).toBe('es');
    expect(within(languageGroup()).getByRole('button', { name: 'Español' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(queryClient.getQueryData(ME_QUERY_KEY)).toMatchObject({ locale: 'es' });
  });

  describe('name', () => {
    const nameField = () => screen.getByRole('textbox', { name: 'Nombre que ven los demás' });
    const save = () => screen.getByRole('button', { name: 'Guardar nombre' });

    it('saves a trimmed name with PATCH /me and shows it in the header', async () => {
      const user = userEvent.setup();
      const { spy, queryClient } = await renderProfile();
      expect(save()).toBeDisabled();
      expect(save()).not.toHaveClass('bg-coral-pop');

      await user.clear(nameField());
      await user.type(nameField(), '  Noah   Mata ');
      await user.click(save());

      expect(await screen.findByText('Nombre actualizado.')).toBeInTheDocument();
      const call = spy.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(call?.[0]).toBe('/api/v1/me');
      expect(call?.[1]?.body).toBe('{"name":"Noah Mata"}');
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Noah Mata');
      expect(nameField()).toHaveValue('Noah Mata');
      expect(queryClient.getQueryData(ME_QUERY_KEY)).toMatchObject({ name: 'Noah Mata' });
    });

    it.each([
      ['   ', 'Escribe un nombre.'],
      ['Secret Elf #3', 'Ese nombre está reservado. Elige otro.'],
      ['elfo  SECRETO', 'Ese nombre está reservado. Elige otro.'],
      ['Usuario eliminado', 'Ese nombre está reservado. Elige otro.'],
    ])('rejects %j without calling the server', async (value, error) => {
      const user = userEvent.setup();
      const { spy } = await renderProfile();
      await user.clear(nameField());
      await user.type(nameField(), value);
      await user.click(save());

      expect(await screen.findByText(error)).toBeInTheDocument();
      expect(nameField()).toHaveAttribute('aria-invalid', 'true');
      expect(spy.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    });

    it('a failed save keeps the old name and says so', async () => {
      const user = userEvent.setup();
      const { queryClient } = await renderProfile({ patchError: 500 });
      await user.clear(nameField());
      await user.type(nameField(), 'Noah');
      await user.click(save());

      expect(await screen.findByText('Algo salió mal. Inténtalo de nuevo.')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(TEST_USER.name);
      expect(queryClient.getQueryData(ME_QUERY_KEY)).toMatchObject({ name: TEST_USER.name });
    });
  });

  it('sign out: a nav pill that logs out and lands on the Landing page', async () => {
    const user = userEvent.setup();
    const { calls, router } = await renderProfile();
    const signOut = screen.getByRole('button', { name: 'Cerrar sesión' });
    expect(signOut).toHaveClass('border-ink-black', 'rounded-full-2');
    expect(signOut).not.toHaveClass('bg-coral-pop');

    await user.click(signOut);

    expect(await screen.findByRole('link', { name: 'Continuar con Google' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(calls()).toContain('POST /api/v1/auth/logout');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('uses no coral in the page content', async () => {
    await renderProfile();
    expect(screen.getByRole('main').querySelectorAll('.bg-coral-pop')).toHaveLength(0);
  });

  it('has no axe violations', async () => {
    const { container } = await renderProfile();
    expect(await axe(container)).toHaveNoViolations();
  });
});
