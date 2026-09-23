import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { initials } from '@/lib/initials';

import { Avatar } from './Avatar';

describe('initials', () => {
  it.each([
    ['Ana María Pérez', 'AP'],
    ['ana', 'A'],
    ['  lucía   vargas ', 'LV'],
    ['Élodie', 'É'],
    ['', ''],
  ])('%j → %j', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

describe('Avatar', () => {
  it('renders the image in a black-bordered circle', () => {
    render(<Avatar src="https://example.test/a.png" alt="Ana Rojas" />);
    const img = screen.getByRole('img', { name: 'Ana Rojas' });
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(img.parentElement).toHaveClass('rounded-full-2', 'border', 'border-ink-black');
  });

  it('falls back to initials without a src', () => {
    render(<Avatar alt="Carlos Méndez" />);
    const fallback = screen.getByRole('img', { name: 'Carlos Méndez' });
    expect(fallback).toHaveTextContent('CM');
    expect(fallback).toHaveClass('rounded-full-2', 'border-ink-black');
  });

  it('falls back to initials when the image fails to load', () => {
    render(<Avatar src="/broken.png" name="Lucía Vargas" alt="Lucía" />);
    fireEvent.error(screen.getByRole('img', { name: 'Lucía' }));
    const fallback = screen.getByRole('img', { name: 'Lucía' });
    expect(fallback.tagName).toBe('SPAN');
    expect(fallback).toHaveTextContent('LV');
  });

  it.each([
    ['sm', 'size-[32px]'],
    ['md', 'size-[44px]'],
    ['lg', 'size-[64px]'],
    ['xl', 'size-[96px]'],
  ] as const)('size %s', (size, cls) => {
    render(<Avatar size={size} alt="A" />);
    expect(screen.getByRole('img')).toHaveClass(cls);
  });

  it('anonymous: cream circle with the ✦ glyph and no image', () => {
    const { container } = render(<Avatar anonymous alt="Secret Elf #3" />);
    const avatar = screen.getByRole('img', { name: 'Secret Elf #3' });
    expect(avatar).toHaveClass('bg-cream-linen', 'font-mono', 'border-ink-black');
    expect(avatar).toHaveTextContent('✦');
    expect(container.querySelector('img')).toBeNull();
  });

  it('forbids an image or a name on anonymous avatars at the type level', () => {
    // @ts-expect-error anonymous avatars never take a src
    const withSrc = <Avatar anonymous src="/me.png" alt="Secret Elf #3" />;
    // @ts-expect-error anonymous avatars never take a name
    const withName = <Avatar anonymous name="Ana" alt="Secret Elf #3" />;
    expect([withSrc, withName]).toHaveLength(2);
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div>
        <Avatar src="https://example.test/a.png" alt="Ana" />
        <Avatar alt="Carlos Méndez" />
        <Avatar anonymous alt="Secret Elf #3" />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
