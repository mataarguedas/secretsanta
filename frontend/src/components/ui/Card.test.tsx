import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { Card } from './Card';

describe('Card', () => {
  it('content card: white, square, mist border, 20px padding', () => {
    render(<Card data-testid="card">Body</Card>);
    const card = screen.getByTestId('card');
    expect(card.tagName).toBe('DIV');
    expect(card).toHaveClass('bg-pure-white', 'rounded-none', 'border', 'border-mist', 'p-20');
    expect(card.className).not.toMatch(/shadow|rounded-full/);
  });

  it('renders as a semantic element', () => {
    render(
      <ul>
        <Card as="li" data-testid="card">
          Item
        </Card>
      </ul>,
    );
    expect(screen.getByTestId('card').tagName).toBe('LI');
  });

  it('interactive link card is one focus stop with a black border', async () => {
    render(
      <MemoryRouter>
        <Card asChild>
          <a href="/events/1">
            <span>Oficina</span>
            <span>3 participantes</span>
          </a>
        </Card>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /Oficina/ });
    expect(link).toHaveClass('border-ink-black', 'bg-pure-white', 'rounded-none', 'block');
    await userEvent.tab();
    expect(link).toHaveFocus();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div>
        <Card>
          <h2>Title</h2>
        </Card>
        <Card asChild>
          <a href="/x">Link card</a>
        </Card>
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
