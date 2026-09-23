import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { Pill, PillToggle } from './Pill';

describe('Pill', () => {
  it('renders a non-interactive 999px chip', () => {
    render(<Pill>Alta</Pill>);
    const pill = screen.getByText('Alta');
    expect(pill.tagName).toBe('SPAN');
    expect(pill).toHaveClass('rounded-full-2', 'bg-bone');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('outline tone uses the quiet mist border, never the interactive black one', () => {
    render(<Pill tone="outline">12</Pill>);
    const pill = screen.getByText('12');
    expect(pill).toHaveClass('border-mist');
    expect(pill).not.toHaveClass('border-ink-black');
  });
});

describe('PillToggle', () => {
  function Controlled() {
    const [on, setOn] = useState(false);
    return (
      <PillToggle pressed={on} onPressedChange={setOn}>
        Anónimo
      </PillToggle>
    );
  }

  it('exposes and toggles aria-pressed', async () => {
    render(<Controlled />);
    const toggle = screen.getByRole('button', { name: 'Anónimo' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveClass('rounded-full-2', 'min-h-11', 'border-ink-black');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveClass('bg-ink-black', 'text-pure-white');
  });

  it('calls onClick and respects preventDefault', async () => {
    const onPressedChange = vi.fn();
    render(
      <PillToggle
        pressed={false}
        onPressedChange={onPressedChange}
        onClick={(e) => {
          e.preventDefault();
        }}
      >
        x
      </PillToggle>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onPressedChange).not.toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div>
        <Pill>Alta</Pill>
        <PillToggle pressed>Con nombre</PillToggle>
        <PillToggle pressed={false}>Anónimo</PillToggle>
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
