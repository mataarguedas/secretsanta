import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { ToastProvider } from '@/components/ui';
import i18n from '@/i18n';

import { routes } from '../routes';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { router, ...utils };
}

const desktopNav = () => screen.getByRole('navigation', { name: 'Navegación principal' });
const tabBar = () => screen.getByRole('navigation', { name: 'Navegación' });

describe('AppLayout', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok', db: 'ok', redis: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('desktop header: Events and Chats pills, centered wordmark, profile avatar', () => {
    renderAt('/');
    const header = desktopNav().parentElement ?? document.body;
    expect(header).toHaveClass('hidden', 'md:grid', 'max-w-[1200px]');
    const links = within(desktopNav()).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Eventos', 'Chats']);
    for (const link of links) expect(link).toHaveClass('rounded-full-2', 'min-h-11');
    expect(within(header).getByRole('link', { name: 'Secret Santa, inicio' })).toHaveClass(
      'font-serif',
    );
    expect(within(header).getByRole('link', { name: 'Perfil' })).toHaveAttribute(
      'href',
      '/profile',
    );
  });

  it('marks the active section in both navs (coral pill)', () => {
    renderAt('/events/123/wishlists');
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

  it('bottom tab bar: fixed, mobile only, safe-area padded, three tabs', () => {
    renderAt('/chats/abc');
    expect(tabBar()).toHaveClass('fixed', 'bottom-0', 'md:hidden');
    expect(tabBar().className).toContain('pb-[env(safe-area-inset-bottom)]');
    const tabs = within(tabBar()).getAllByRole('link');
    expect(tabs.map((l) => l.textContent)).toEqual(['Eventos', 'Chats', 'Perfil']);
    expect(within(tabBar()).getByRole('link', { name: 'Chats' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('pads the content so nothing hides behind the tab bar', () => {
    renderAt('/profile');
    const main = screen.getByRole('main');
    expect(main).toHaveClass('max-w-[1200px]', 'mx-auto', 'gap-32', 'md:gap-[64px]');
    expect(main.className).toContain('pb-[calc(96px+env(safe-area-inset-bottom))]');
  });

  it.each([
    ['/events/new', 'Crear evento'],
    ['/events/123', 'Evento'],
    ['/events/123/manage', 'Evento'],
    ['/join/tok_abc', 'Unirte al evento'],
    ['/chats', 'Chats'],
    ['/chats/123', 'Conversación'],
    ['/profile', 'Perfil'],
    ['/privacy', 'Política de privacidad'],
    ['/terms', 'Términos del servicio'],
  ])('%s shows its placeholder title', (path, title) => {
    renderAt(path);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(title);
    expect(document.title).toBe(`${title} · Secret Santa`);
  });

  it('unknown paths show the not-found page', () => {
    renderAt('/nope');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'No encontramos esta página',
    );
  });

  it('serves /__ui in development', async () => {
    renderAt('/__ui');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Componentes de interfaz' }),
    ).toBeInTheDocument();
  });

  it('navigates with the tab bar', async () => {
    const user = userEvent.setup();
    const { router } = renderAt('/');
    await user.click(within(tabBar()).getByRole('link', { name: 'Chats' }));
    expect(router.state.location.pathname).toBe('/chats');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Chats');
  });

  it('has a skip link to the main content', () => {
    renderAt('/profile');
    expect(screen.getByRole('link', { name: 'Saltar al contenido' })).toHaveAttribute(
      'href',
      '#main',
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('has no axe violations', async () => {
    const { container } = renderAt('/');
    await waitFor(() => {
      expect(screen.getByTestId('health')).toHaveTextContent('ok');
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
