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
  it('shows the Google identity: large avatar, serif name, read-only email', async () => {
    await renderProfile();
    const main = screen.getByRole('main');
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('font-serif');
    expect(within(main).getByRole('img', { name: TEST_USER.name })).toHaveAttribute(
      'src',
      TEST_USER.avatar_url,
    );
    expect(within(main).getByText(TEST_USER.email)).toBeInTheDocument();
    expect(within(main).queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      within(main).getByText('Tu nombre, foto y correo vienen de tu cuenta de Google.'),
    ).toBeInTheDocument();
    expect(document.title).toBe('Secret Santa · Perfil');
  });

  it('shows only the sections that exist (no empty placeholders)', async () => {
    await renderProfile();
    const headings = within(screen.getByRole('main')).getAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(['Idioma']);
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
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Language');
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
