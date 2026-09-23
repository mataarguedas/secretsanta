import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import i18n from '@/i18n';
import { jsonResponse, mockSession, renderApp, TEST_USER } from '@/test/render';

const desktopNav = () => screen.getByRole('navigation', { name: 'Navegación principal' });
const tabBar = () => screen.getByRole('navigation', { name: 'Navegación' });

/** Signed-in app at `path`, once the session has resolved. */
async function renderSignedIn(path: string, me = TEST_USER) {
  mockSession({ me });
  const utils = renderApp(path);
  await screen.findByRole('main');
  return utils;
}

describe('AppLayout (signed in)', () => {
  it('desktop header: Events and Chats pills, centered wordmark, the Google avatar', async () => {
    await renderSignedIn('/');
    const header = desktopNav().parentElement ?? document.body;
    expect(header).toHaveClass('hidden', 'md:grid', 'max-w-[1200px]');
    const links = within(desktopNav()).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Eventos', 'Chats']);
    for (const link of links) expect(link).toHaveClass('rounded-full-2', 'min-h-11');
    expect(within(header).getByRole('link', { name: 'Secret Santa, inicio' })).toHaveClass(
      'font-serif',
    );
    const profile = within(header).getByRole('link', { name: 'Perfil' });
    expect(profile).toHaveAttribute('href', '/profile');
    expect(within(profile).getByRole('img', { name: 'Perfil' })).toHaveAttribute(
      'src',
      TEST_USER.avatar_url,
    );
  });

  it('falls back to the initials of the name without a Google photo', async () => {
    await renderSignedIn('/', { ...TEST_USER, avatar_url: null });
    const profile = within(desktopNav().parentElement ?? document.body).getByRole('link', {
      name: 'Perfil',
    });
    expect(within(profile).getByRole('img', { name: 'Perfil' })).toHaveTextContent('AR');
  });

  it('marks the active section in both navs (coral pill)', async () => {
    await renderSignedIn('/events/123/wishlists');
    const events = within(desktopNav()).getByRole('link', { name: 'Eventos' });
    expect(events).toHaveAttribute('aria-current', 'page');
    expect(events).toHaveClass('bg-coral-pop');
    expect(within(desktopNav()).getByRole('link', { name: 'Chats' })).not.toHaveAttribute(
      'aria-current',
    );

    const tab = within(tabBar()).getByRole('link', { name: 'Eventos' });
    expect(tab).toHaveAttribute('aria-current', 'page');
    expect(tab).toHaveClass('bg-coral-pop', 'rounded-full-2');
  });

  it('bottom tab bar: fixed, mobile only, safe-area padded, three tabs', async () => {
    await renderSignedIn('/chats/abc');
    expect(tabBar()).toHaveClass('fixed', 'bottom-0', 'md:hidden');
    expect(tabBar().className).toContain('pb-[env(safe-area-inset-bottom)]');
    const tabs = within(tabBar()).getAllByRole('link');
    expect(tabs.map((l) => l.textContent)).toEqual(['Eventos', 'Chats', 'Perfil']);
    expect(within(tabBar()).getByRole('link', { name: 'Chats' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('pads the content so nothing hides behind the tab bar', async () => {
    await renderSignedIn('/profile');
    const main = screen.getByRole('main');
    expect(main).toHaveClass('max-w-[1200px]', 'mx-auto', 'gap-32', 'md:gap-[64px]');
    expect(main.className).toContain('pb-[calc(96px+env(safe-area-inset-bottom))]');
  });

  it('shows the dashboard at /', async () => {
    await renderSignedIn('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tu primer intercambio empieza aquí' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Continuar con Google' })).not.toBeInTheDocument();
  });

  it.each([
    ['/events/new', 'Crear evento'],
    ['/chats', 'Chats'],
    ['/chats/123', 'Conversación'],
    ['/privacy', 'Política de privacidad'],
    ['/terms', 'Términos del servicio'],
  ])('%s shows its placeholder title', async (path, title) => {
    await renderSignedIn(path);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(title);
    expect(document.title).toBe(`Secret Santa · ${title}`);
  });

  it('unknown paths show the not-found page', async () => {
    await renderSignedIn('/nope');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'No encontramos esta página',
    );
  });

  it('serves /__ui in development', async () => {
    await renderSignedIn('/__ui');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Componentes de interfaz' }),
    ).toBeInTheDocument();
  });

  it('navigates with the tab bar', async () => {
    const user = userEvent.setup();
    const { router } = await renderSignedIn('/');
    await user.click(within(tabBar()).getByRole('link', { name: 'Chats' }));
    expect(router.state.location.pathname).toBe('/chats');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Chats');
  });

  it('has a skip link to the main content', async () => {
    await renderSignedIn('/profile');
    expect(screen.getByRole('link', { name: 'Saltar al contenido' })).toHaveAttribute(
      'href',
      '#main',
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('switches the UI to the saved locale', async () => {
    await renderSignedIn('/events/new', { ...TEST_USER, locale: 'en' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Create event');
    expect(i18n.language).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(
      within(screen.getByRole('navigation', { name: 'Navigation' }))
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Events', 'Chats', 'Profile']);
  });

  it('has no axe violations', async () => {
    const { container } = await renderSignedIn('/');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('AppLayout (signed out)', () => {
  it('shows only the centered wordmark bar: no nav pills, no tab bar', async () => {
    mockSession({ me: null });
    renderApp('/privacy');
    const main = await screen.findByRole('main');
    expect(screen.getByRole('link', { name: 'Secret Santa, inicio' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Perfil' })).not.toBeInTheDocument();
    expect(main.className).not.toContain('96px');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Política de privacidad');
  });

  it('keeps the browser language', async () => {
    mockSession({ me: null });
    renderApp('/');
    await screen.findByRole('main');
    expect(i18n.language).toBe('es');
  });
});

describe('AppLayout (resolving the session)', () => {
  it('shows a full-page loading state, and no layout, while /me is pending', async () => {
    let resolve: (r: Response) => void = () => undefined;
    vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise<Response>((r) => {
        resolve = r;
      }),
    );
    renderApp('/events/new');
    expect(screen.getByRole('status')).toHaveTextContent('Cargando tu sesión…');
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();

    resolve(jsonResponse(200, TEST_USER));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Crear evento');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('offers a retry when the session check fails (not a sign-out)', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(jsonResponse(200, TEST_USER));
    const { router } = renderApp('/events/new');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'No pudimos conectarnos' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/events/new'); // not redirected to the landing
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Crear evento' }),
    ).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
