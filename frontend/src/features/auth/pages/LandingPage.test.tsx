import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import i18n from '@/i18n';
import { renderWithProviders } from '@/test/render';

import { LandingPage } from './LandingPage';

const cta = () => screen.getByRole('link', { name: 'Continuar con Google' });

describe('LandingPage', () => {
  it('renders a serif headline, one line and a single coral Google pill', () => {
    const { container } = renderWithProviders(<LandingPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Regalar es mejor en secreto.',
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('font-serif', 'font-medium');
    expect(screen.getByText(/Organiza tu intercambio/)).toHaveClass('text-charcoal');
    expect(cta()).toHaveClass('bg-coral-pop', 'rounded-full-2');
    expect(cta()).toHaveAttribute('href', '/api/v1/auth/google/login?next=%2F');
    expect(container.querySelectorAll('.bg-coral-pop')).toHaveLength(1);
    expect(container.querySelector('img, svg')).toBeNull(); // no illustrations
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.title).toBe('Secret Santa');
  });

  it('is translated', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<LandingPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Giving is better in secret.',
    );
    expect(screen.getByRole('link', { name: 'Continue with Google' })).toBeInTheDocument();
  });

  it('carries ?next= into the login URL', () => {
    renderWithProviders(<LandingPage />, {
      initialEntries: ['/?next=%2Fprofile%3Ftab%3Dx'],
    });
    expect(cta()).toHaveAttribute('href', '/api/v1/auth/google/login?next=%2Fprofile%3Ftab%3Dx');
  });

  it.each(['https://evil.example', '//evil.example', '/\\evil.example'])(
    'drops a hostile next (%s)',
    (next) => {
      renderWithProviders(<LandingPage />, {
        initialEntries: [`/?next=${encodeURIComponent(next)}`],
      });
      expect(cta()).toHaveAttribute('href', '/api/v1/auth/google/login?next=%2F');
    },
  );

  it('shows the OAuth failure from the callback', () => {
    renderWithProviders(<LandingPage />, {
      initialEntries: ['/?auth_error=AUTH_OAUTH_FAILED'],
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No pudimos iniciar sesión con Google. Inténtalo de nuevo.',
    );
    expect(screen.getByRole('alert')).toHaveClass('text-error');
  });

  it('falls back to the generic message for an unknown code', () => {
    renderWithProviders(<LandingPage />, { initialEntries: ['/?auth_error=SOMETHING_NEW'] });
    expect(screen.getByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.');
  });

  it.each(['app.name', 'errors.X', '<b>x</b>'])('ignores a malformed code (%s)', (code) => {
    renderWithProviders(<LandingPage />, {
      initialEntries: [`/?auth_error=${encodeURIComponent(code)}`],
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('links the privacy and terms pages from its footer', () => {
    renderWithProviders(<LandingPage />);
    const footer = screen.getByRole('contentinfo', { name: 'Legal' });
    expect(within(footer).getByRole('link', { name: 'Política de privacidad' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(within(footer).getByRole('link', { name: 'Términos del servicio' })).toHaveAttribute(
      'href',
      '/terms',
    );
  });

  it('has no axe violations', async () => {
    const { container } = renderWithProviders(<LandingPage />, {
      initialEntries: ['/?auth_error=AUTH_OAUTH_FAILED'],
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
