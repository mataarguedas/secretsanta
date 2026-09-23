import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { Banner } from './Banner';
import { mountedBannerCount } from './bannerRegistry';
import { Button } from './Button';

describe('Banner', () => {
  it('renders the coral strip with centered white serif text', () => {
    render(<Banner>Invita a tus amigos</Banner>);
    const text = screen.getByText('Invita a tus amigos');
    expect(text).toHaveClass('font-serif', 'text-heading', 'text-pure-white');
    expect(text.parentElement).toHaveClass('bg-coral-pop', 'text-center', 'min-h-[120px]');
  });

  it('renders the optional action slot', () => {
    render(<Banner action={<Button variant="nav">Copiar enlace</Button>}>Invita</Banner>);
    expect(screen.getByRole('button', { name: 'Copiar enlace' })).toBeInTheDocument();
  });

  it('can be a heading', () => {
    render(<Banner as="h2">Te toca regalarle a…</Banner>);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Te toca regalarle a…');
  });

  it('warns in development when more than one Banner is mounted', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { unmount } = render(<Banner>Uno</Banner>);
    expect(mountedBannerCount()).toBe(1);
    expect(warn).not.toHaveBeenCalled();

    const second = render(<Banner>Dos</Banner>);
    expect(mountedBannerCount()).toBe(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('2 Banners are mounted'));

    second.unmount();
    unmount();
    expect(mountedBannerCount()).toBe(0);
  });

  it('has no axe violations', async () => {
    const { container } = render(<Banner>Invita a tus amigos</Banner>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
