import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import i18n from '@/i18n';
import { renderWithProviders } from '@/test/render';

import UiShowcasePage from './UiShowcasePage';

describe('UiShowcasePage', () => {
  it('renders every primitive, including error states and the anonymous avatar', () => {
    renderWithProviders(<UiShowcasePage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Componentes de interfaz');
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument();
    expect(screen.getByText('Debe tener entre 3 y 80 caracteres.')).toHaveClass('text-error');
    expect(screen.getAllByRole('img', { name: 'Elfo secreto #3' })).toHaveLength(3);
    expect(screen.getByText('₡')).toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });

  it('has exactly one coral primary button', () => {
    const { container } = renderWithProviders(<UiShowcasePage />);
    expect(container.querySelectorAll('button.bg-coral-pop')).toHaveLength(1);
  });

  it('is fully translated to English', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<UiShowcasePage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('UI components');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderWithProviders(<UiShowcasePage />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
