import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { Eyebrow } from './Eyebrow';

describe('Eyebrow', () => {
  it('renders the tracked-out mono coral uppercase label as a <p>', () => {
    render(<Eyebrow>Abierto</Eyebrow>);
    const label = screen.getByText('Abierto');
    expect(label.tagName).toBe('P');
    expect(label).toHaveClass(
      'font-mono',
      'uppercase',
      'text-coral-pop',
      'tracking-[0.056em]',
      'text-sm',
    );
  });

  it('can render as a <span>', () => {
    render(<Eyebrow as="span">Secret Elf #3</Eyebrow>);
    expect(screen.getByText('Secret Elf #3').tagName).toBe('SPAN');
  });

  it('has no axe violations', async () => {
    const { container } = render(<Eyebrow>Organizando</Eyebrow>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
