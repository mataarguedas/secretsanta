import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { renderWithProviders } from '@/test/render';

import type { LinkPreview } from '../api';
import { LinkPreviewCard } from './LinkPreviewCard';

const VIDEO_URL = 'https://www.youtube.com/watch?v=9h30Bx4Klxg&list=RD9h30Bx4Klxg&start_radio=1';

function preview(overrides: Partial<LinkPreview> = {}): LinkPreview {
  return {
    url: 'https://tienda.cr/lego',
    title: 'Lego Ideas',
    description: 'Un set grande',
    site_name: 'Juguetería',
    is_video: false,
    image_url: 'http://localhost:9000/secret-santa/events/e/conversations/c/p.webp?X-Amz=1',
    image_width: 800,
    image_height: 450,
    ...overrides,
  };
}

describe('LinkPreviewCard', () => {
  it('is one interactive card that opens the link in a new tab', async () => {
    const { container } = renderWithProviders(<LinkPreviewCard preview={preview()} />);
    const link = screen.getByRole('link', {
      name: 'Lego Ideas, Juguetería (se abre en una pestaña nueva)',
    });
    expect(link).toHaveAttribute('href', 'https://tienda.cr/lego');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
    // DESIGN.md: interactive card = white, square, black hairline, never a shadow.
    expect(link).toHaveClass('bg-pure-white', 'rounded-none', 'border-ink-black');
    expect(link.className).not.toMatch(/shadow/);
    expect(link).toHaveTextContent('Juguetería');
    expect(link).toHaveTextContent('Un set grande');

    // The picture is the server's copy (R2), decorative next to the title, sized up front.
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', preview().image_url);
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveStyle({ aspectRatio: '800 / 450' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('a video says so and shows a play mark', () => {
    const { container } = renderWithProviders(
      <LinkPreviewCard
        preview={preview({
          url: VIDEO_URL,
          title: 'La canción',
          description: 'El canal',
          site_name: 'YouTube',
          is_video: true,
        })}
      />,
    );
    const link = screen.getByRole('link', {
      name: 'Video: La canción, YouTube (se abre en una pestaña nueva)',
    });
    expect(link).toHaveAttribute('href', VIDEO_URL);
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('▶');
  });

  it('without a picture or a title it still makes sense', () => {
    const { container } = renderWithProviders(
      <LinkPreviewCard
        preview={preview({
          url: 'https://www.ejemplo.cr/x',
          title: null,
          description: null,
          site_name: null,
          image_url: null,
          image_width: null,
          image_height: null,
        })}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(
      screen.getByRole('link', { name: 'ejemplo.cr, ejemplo.cr (se abre en una pestaña nueva)' }),
    ).toBeInTheDocument();
  });

  it('an expired picture is hidden, the text stays', () => {
    const { container } = renderWithProviders(<LinkPreviewCard preview={preview()} />);
    const img = container.querySelector('img');
    if (!img) throw new Error('no img');
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('link')).toHaveTextContent('Lego Ideas');
  });
});
