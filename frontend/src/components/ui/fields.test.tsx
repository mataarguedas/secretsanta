import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { Input } from './Input';
import { Select } from './Select';
import { Switch } from './Switch';
import { Textarea } from './Textarea';

describe('Input', () => {
  it('is labelled, mono, on a bone pill', () => {
    render(<Input label="Nombre" />);
    const input = screen.getByLabelText('Nombre');
    expect(input).toHaveClass('font-mono');
    expect(input.parentElement).toHaveClass('bg-bone', 'rounded-full-2', 'min-h-11');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('links help and error via aria-describedby and sets aria-invalid', () => {
    render(<Input label="Nombre" help="Entre 3 y 80" error="Muy corto" />);
    const input = screen.getByLabelText('Nombre');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Entre 3 y 80 Muy corto');
    expect(screen.getByText('Muy corto')).toHaveClass('text-error');
  });

  it('keeps a caller-provided aria-describedby', () => {
    render(
      <>
        <p id="extra">Extra</p>
        <Input label="Nombre" aria-describedby="extra" help="Ayuda" />
      </>,
    );
    expect(screen.getByLabelText('Nombre')).toHaveAccessibleDescription('Extra Ayuda');
  });

  it('renders the prefix slot', () => {
    render(<Input label="Presupuesto" prefix="₡" />);
    expect(screen.getByText('₡')).toBeInTheDocument();
  });

  it('forwards the ref (React Hook Form register) and accepts typing', async () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input label="Nombre" ref={ref} />);
    await userEvent.type(screen.getByLabelText('Nombre'), 'Oficina');
    expect(ref.current?.value).toBe('Oficina');
  });
});

describe('Textarea', () => {
  it('is labelled with help and error', () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea label="Descripción" help="Opcional" error="Muy largo" ref={ref} />);
    const textarea = screen.getByLabelText('Descripción');
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(textarea).toHaveAccessibleDescription('Opcional Muy largo');
    expect(textarea).toHaveClass('font-mono', 'bg-bone');
    expect(ref.current).toBe(textarea);
  });
});

describe('Select', () => {
  it('is a labelled native select styled as a pill', async () => {
    render(
      <Select label="Prioridad" defaultValue="medium" error="Requerido">
        <option value="high">Alta</option>
        <option value="medium">Media</option>
      </Select>,
    );
    const select = screen.getByLabelText('Prioridad');
    expect(select).toHaveValue('medium');
    expect(select).toHaveClass('rounded-full-2', 'font-mono', 'appearance-none');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    await userEvent.selectOptions(select, 'high');
    expect(select).toHaveValue('high');
  });
});

describe('Switch', () => {
  it('uncontrolled: toggles aria-checked, also via its label', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch label="Chat grupal" onCheckedChange={onCheckedChange} />);
    const sw = screen.getByRole('switch', { name: 'Chat grupal' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).toHaveClass('rounded-full-2');
    await userEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByText('Chat grupal'));
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(onCheckedChange.mock.calls).toEqual([[true], [false]]);
  });

  it('controlled: reflects the prop and reports changes', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch label="Recordatorios" checked onCheckedChange={onCheckedChange} />);
    const sw = screen.getByRole('switch');
    await userEvent.click(sw);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
    expect(sw).toHaveAttribute('aria-checked', 'true'); // parent didn't update
  });

  it('keyboard: Space toggles', async () => {
    render(<Switch label="Chat grupal" />);
    await userEvent.tab();
    await userEvent.keyboard(' ');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('disabled does not toggle', async () => {
    render(<Switch label="Chat grupal" disabled />);
    const sw = screen.getByRole('switch');
    await userEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  it('describes itself with the description', () => {
    render(<Switch label="Chat grupal" description="Todos pueden escribir" />);
    expect(screen.getByRole('switch')).toHaveAccessibleDescription('Todos pueden escribir');
  });
});

describe('form fields a11y', () => {
  it('has no axe violations', async () => {
    const { container } = render(
      <form>
        <Input label="Nombre" error="Muy corto" />
        <Input label="Presupuesto" prefix="₡" help="Colones" />
        <Textarea label="Descripción" />
        <Select label="Prioridad">
          <option>Media</option>
        </Select>
        <Switch label="Chat grupal" description="Todos" />
      </form>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
