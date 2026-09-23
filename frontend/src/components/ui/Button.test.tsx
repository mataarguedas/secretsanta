import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { Button } from './Button';

describe('Button', () => {
  it.each([
    ['primary', ['bg-coral-pop', 'text-pure-white', 'text-body-lg']],
    ['secondary', ['border', 'border-terracotta-whisper', 'text-terracotta-whisper']],
    ['nav', ['border', 'border-ink-black', 'text-ink-black']],
    ['ghost', ['text-ink-black']],
  ] as const)('%s variant is a content-sized pill with ≥ 44px hit target', (variant, classes) => {
    render(<Button variant={variant}>Go</Button>);
    const button = screen.getByRole('button', { name: 'Go' });
    expect(button).toHaveClass('rounded-full-2', 'px-19', 'py-6', 'min-h-11', 'w-auto', ...classes);
    expect(button.className).not.toMatch(/shadow|font-bold|font-semibold/);
  });

  it('only the primary variant uses the coral fill', () => {
    render(
      <>
        <Button variant="secondary">a</Button>
        <Button variant="nav">b</Button>
        <Button variant="ghost">c</Button>
      </>,
    );
    for (const button of screen.getAllByRole('button')) {
      expect(button).not.toHaveClass('bg-coral-pop');
    }
  });

  it('defaults to type="button" and forwards clicks', async () => {
    const onClick = vi.fn();
    render(
      <Button variant="nav" onClick={onClick}>
        Go
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('type', 'button');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('allows type="submit"', () => {
    render(
      <Button variant="primary" type="submit">
        Save
      </Button>,
    );
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('loading shows a spinner, sets aria-busy, disables and announces', async () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Cargando…');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disabled blocks clicks', async () => {
    const onClick = vi.fn();
    render(
      <Button variant="nav" disabled onClick={onClick}>
        Go
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('iconOnly takes its accessible name from aria-label and is a 44px circle', () => {
    render(
      <Button variant="nav" iconOnly aria-label="Cerrar">
        <svg aria-hidden="true" />
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Cerrar' });
    expect(button).toHaveClass('size-11', 'rounded-full-2');
  });

  it('enforces the aria-label and asChild rules at the type level', () => {
    // @ts-expect-error iconOnly requires aria-label
    const missingLabel = <Button variant="nav" iconOnly />;
    // @ts-expect-error variant is required (no implicit coral primary)
    const missingVariant = <Button>x</Button>;
    const asChildLoading = (
      // @ts-expect-error loading is not supported with asChild
      <Button variant="nav" asChild loading>
        <a href="/">x</a>
      </Button>
    );
    expect([missingLabel, missingVariant, asChildLoading]).toHaveLength(3);
  });

  it('asChild styles a link instead of rendering a button', () => {
    render(
      <Button variant="nav" asChild>
        <a href="/events" className="extra">
          Events
        </a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Events' });
    expect(link).toHaveAttribute('href', '/events');
    expect(link).toHaveClass('rounded-full-2', 'border-ink-black', 'min-h-11', 'extra');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('fullWidthOnMobile is full width below md only', () => {
    render(
      <Button variant="primary" type="submit" fullWidthOnMobile>
        Save
      </Button>,
    );
    expect(screen.getByRole('button')).toHaveClass('w-full', 'md:w-auto', 'rounded-full-2');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div>
        <Button variant="primary">Create</Button>
        <Button variant="secondary">View</Button>
        <Button variant="nav">Events</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="nav" loading>
          Saving
        </Button>
        <Button variant="nav" iconOnly aria-label="Cerrar">
          <svg aria-hidden="true" />
        </Button>
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
