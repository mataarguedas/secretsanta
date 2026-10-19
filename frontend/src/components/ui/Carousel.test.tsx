import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { Carousel } from './Carousel';

const slides = ['a', 'b', 'c'].map((name) => <img key={name} src={`/${name}.webp`} alt={name} />);

function track() {
  return screen.getByTestId('carousel-viewport').firstElementChild as HTMLElement;
}

describe('Carousel', () => {
  it('is a labelled carousel region with an "n / N" indicator', () => {
    render(<Carousel label="Fotos de Taza" slides={slides} />);
    expect(screen.getByRole('region', { name: 'Fotos de Taza' })).toHaveAttribute(
      'aria-roledescription',
      'carrusel',
    );
    expect(screen.getByText('1 / 3')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getAllByRole('group', { hidden: true })).toHaveLength(3);
    expect(screen.getByRole('group', { name: '1 de 3' })).not.toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('arrows are 44px hit areas around 32px cream circles with a black border', () => {
    render(<Carousel label="Fotos" slides={slides} />);
    const next = screen.getByRole('button', { name: 'Foto siguiente' });
    expect(next).toHaveClass('size-11', 'rounded-full-2');
    expect(next.firstElementChild).toHaveClass(
      'size-32',
      'rounded-full-2',
      'bg-cream-linen',
      'border',
      'border-ink-black',
    );
    expect(screen.getByRole('button', { name: 'Foto anterior' })).toBeDisabled();
  });

  it('navigates with the arrows and stops at the ends', async () => {
    const user = userEvent.setup();
    render(<Carousel label="Fotos" slides={slides} />);
    const next = screen.getByRole('button', { name: 'Foto siguiente' });
    await user.click(next);
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(track().style.transform).toContain('-100%');
    await user.click(next);
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(next).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Foto anterior' }));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('navigates with ←/→ when focused', async () => {
    const user = userEvent.setup();
    render(<Carousel label="Fotos" slides={slides} />);
    await user.tab();
    expect(screen.getByRole('region')).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('swipes left and right past the threshold', () => {
    render(<Carousel label="Fotos" slides={slides} />);
    const viewport = screen.getByTestId('carousel-viewport');
    const swipe = (from: number, to: number) => {
      fireEvent.pointerDown(viewport, { clientX: from, pointerId: 1, pointerType: 'touch' });
      fireEvent.pointerMove(viewport, { clientX: to, pointerId: 1, pointerType: 'touch' });
      fireEvent.pointerUp(viewport, { clientX: to, pointerId: 1, pointerType: 'touch' });
    };
    swipe(200, 100);
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    swipe(100, 80); // below the threshold: stays
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    swipe(100, 200);
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('disables the slide transition under reduced motion', () => {
    render(<Carousel label="Fotos" slides={slides} />);
    expect(track()).toHaveClass('motion-reduce:transition-none');
  });

  it('a single slide has no arrows, indicator or tab stop', () => {
    render(<Carousel label="Fotos" slides={[slides[0]]} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('1 / 1')).toBeNull();
    expect(screen.getByRole('region')).not.toHaveAttribute('tabindex');
  });

  it('has no axe violations', async () => {
    const { container } = render(<Carousel label="Fotos" slides={slides} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('starts on initialIndex (clamped) and reports slide changes', async () => {
    const user = userEvent.setup();
    const changes: number[] = [];
    const { unmount } = render(
      <Carousel
        label="Fotos"
        slides={slides}
        initialIndex={1}
        onIndexChange={(i) => changes.push(i)}
      />,
    );
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Foto siguiente' }));
    await user.click(screen.getByRole('button', { name: 'Foto anterior' }));
    expect(changes).toEqual([2, 1]);
    unmount();
    render(<Carousel label="Fotos" slides={slides} initialIndex={9} />);
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
  });

  it('reports a tap on the slide, but not an arrow click or the end of a swipe', async () => {
    const user = userEvent.setup();
    const onSlideClick = vi.fn();
    render(<Carousel label="Fotos" slides={slides} onSlideClick={onSlideClick} />);
    const viewport = screen.getByTestId('carousel-viewport');
    expect(viewport).toHaveClass('cursor-zoom-in');

    await user.click(screen.getByRole('button', { name: 'Foto siguiente' }));
    expect(onSlideClick).not.toHaveBeenCalled();

    fireEvent.pointerDown(viewport, { clientX: 200, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerMove(viewport, { clientX: 100, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerUp(viewport, { clientX: 100, pointerId: 1, pointerType: 'touch' });
    fireEvent.click(viewport);
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(onSlideClick).not.toHaveBeenCalled();

    fireEvent.pointerDown(viewport, { clientX: 100, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerUp(viewport, { clientX: 102, pointerId: 1, pointerType: 'touch' });
    fireEvent.click(viewport);
    expect(onSlideClick).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('without onSlideClick the slides are not a zoom target', () => {
    render(<Carousel label="Fotos" slides={slides} />);
    expect(screen.getByTestId('carousel-viewport')).not.toHaveClass('cursor-zoom-in');
  });
});
