import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { mockSession, renderApp, TEST_USER } from '@/test/render';

describe('ProtectedRoute', () => {
  it.each([
    ['/profile?tab=x', '/?next=%2Fprofile%3Ftab%3Dx'],
    ['/events/new', '/?next=%2Fevents%2Fnew'],
    ['/events/123/wishlists', '/?next=%2Fevents%2F123%2Fwishlists'],
    ['/chats/abc', '/?next=%2Fchats%2Fabc'],
    // TODO(prompt 12): the join screen gets its own sign-in step.
    ['/join/tok_abc', '/?next=%2Fjoin%2Ftok_abc'],
  ])('signed out: %s redirects to %s', async (path, expected) => {
    mockSession({ me: null });
    const { router } = renderApp(path);
    expect(await screen.findByRole('link', { name: 'Continuar con Google' })).toBeInTheDocument();
    const { pathname, search } = router.state.location;
    expect(`${pathname}${search}`).toBe(expected);
    // …and the Google button carries it through the login.
    expect(screen.getByRole('link', { name: 'Continuar con Google' })).toHaveAttribute(
      'href',
      `/api/v1/auth/google/login?next=${encodeURIComponent(path)}`,
    );
  });

  it.each(['/', '/privacy', '/terms', '/nope'])('signed out: %s stays public', async (path) => {
    mockSession({ me: null });
    const { router } = renderApp(path);
    await screen.findByRole('main');
    expect(router.state.location.pathname).toBe(path);
  });

  it('signed in: renders the protected page', async () => {
    mockSession({ me: TEST_USER });
    const { router } = renderApp('/chats?tab=x');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Chats');
    expect(router.state.location.search).toBe('?tab=x');
  });

  it('signed in with a pending next: goes there', async () => {
    mockSession({ me: TEST_USER });
    const { router } = renderApp('/?next=%2Fchats%3Ftab%3Dx');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Chats');
    expect(`${router.state.location.pathname}${router.state.location.search}`).toBe('/chats?tab=x');
  });

  it('signed in with a hostile next: stays on the dashboard', async () => {
    mockSession({ me: TEST_USER });
    const { router } = renderApp('/?next=%2F%2Fevil.example');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tu primer intercambio empieza aquí' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});
