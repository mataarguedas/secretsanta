import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import i18n from '@/i18n';
import { renderWithProviders } from '@/test/render';

import { HomePage } from './HomePage';

const HEALTHY = { status: 'ok', db: 'ok', redis: 'ok' };

function mockHealth(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('HomePage', () => {
  afterEach(async () => {
    await i18n.changeLanguage('es');
  });

  it('renders the eyebrow, heading and body in Spanish by default', () => {
    mockHealth(200, HEALTHY);
    renderWithProviders(<HomePage />);

    expect(screen.getByText('Intercambio de regalos')).toHaveClass('font-mono', 'uppercase');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Regalar es mejor en secreto.',
    );
  });

  it('switches to English', async () => {
    mockHealth(200, HEALTHY);
    await i18n.changeLanguage('en');
    renderWithProviders(<HomePage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Giving is better in secret.',
    );
  });

  it('calls /api/v1/health through the proxy and shows ok', async () => {
    const fetchSpy = mockHealth(200, HEALTHY);
    renderWithProviders(<HomePage />);

    await waitFor(() => {
      expect(screen.getByTestId('health')).toHaveTextContent('Estado del servidor: ok');
    });
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/health', expect.anything());
  });

  it('names the failing component on 503', async () => {
    mockHealth(503, { status: 'error', db: 'ok', redis: 'error' });
    renderWithProviders(<HomePage />);

    await waitFor(() => {
      expect(screen.getByTestId('health')).toHaveTextContent('sin conexión (redis)');
    });
  });

  it('shows an error when the API is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    renderWithProviders(<HomePage />);

    await waitFor(() => {
      expect(screen.getByTestId('health')).toHaveTextContent('sin conexión');
    });
  });

  it('has no axe violations', async () => {
    mockHealth(200, HEALTHY);
    const { container } = renderWithProviders(<HomePage />);
    await waitFor(() => {
      expect(screen.getByTestId('health')).toHaveTextContent('ok');
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
