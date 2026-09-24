import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';

/** Horizontal distance (px) a swipe must travel to change slides. */
const SWIPE_THRESHOLD = 40;

export interface CarouselProps {
  /** One node per slide (usually an <img>). */
  slides: ReactNode[];
  /** Accessible name of the carousel, e.g. the wishlist item title. */
  label: string;
  className?: string;
  /** Controls the frame's aspect ratio; defaults to square. */
  aspectClassName?: string;
  /** Slide shown first (e.g. a lightbox opened on the photo the user was looking at). */
  initialIndex?: number;
  /** Called with the new index whenever the slide changes. */
  onIndexChange?: (index: number) => void;
}

function Arrow({
  direction,
  label,
  disabled,
  onClick,
}: {
  direction: 'previous' | 'next';
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        // 44px hit area around a 32px cream circle with a 1px black border (DESIGN.md).
        'absolute top-1/2 z-10 grid size-11 -translate-y-1/2 cursor-pointer place-items-center rounded-full-2',
        'disabled:pointer-events-none disabled:opacity-0',
        direction === 'previous' ? 'left-6' : 'right-6',
      )}
    >
      <span className="grid size-32 place-items-center rounded-full-2 border border-ink-black bg-cream-linen text-ink-black">
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-16">
          <path
            d={direction === 'previous' ? 'M10 3L5 8l5 5' : 'M6 3l5 5-5 5'}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      </span>
    </button>
  );
}

/**
 * One-slide-at-a-time carousel: arrow buttons, ←/→ keys, swipe/drag, and an "n / N"
 * indicator. The slide transition is disabled under prefers-reduced-motion.
 */
export function Carousel({
  slides,
  label,
  className,
  aspectClassName = 'aspect-square',
  initialIndex = 0,
  onIndexChange,
}: CarouselProps) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(initialIndex, 0), Math.max(slides.length - 1, 0)),
  );
  const [dragX, setDragX] = useState(0);
  const dragStart = useRef<number | null>(null);
  const count = slides.length;
  const multiple = count > 1;

  const go = (next: number) => {
    const clamped = Math.min(Math.max(next, 0), count - 1);
    if (clamped === index) return;
    setIndex(clamped);
    onIndexChange?.(clamped);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(index + 1);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!multiple || (event.pointerType === 'mouse' && event.button !== 0)) return;
    // Capturing a press that started on an arrow would retarget its click away from it.
    if (event.target instanceof Element && event.target.closest('button')) return;
    dragStart.current = event.clientX;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Not supported (jsdom) or the pointer is already gone; swiping still works.
    }
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStart.current === null) return;
    setDragX(event.clientX - dragStart.current);
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStart.current === null) return;
    const dx = event.clientX - dragStart.current;
    dragStart.current = null;
    setDragX(0);
    if (dx <= -SWIPE_THRESHOLD) go(index + 1);
    else if (dx >= SWIPE_THRESHOLD) go(index - 1);
  };

  const dragging = dragX !== 0;

  return (
    <section
      aria-roledescription={t('ui.carousel.roledescription')}
      aria-label={label}
      tabIndex={multiple ? 0 : undefined}
      onKeyDown={multiple ? onKeyDown : undefined}
      className={cn('relative flex flex-col gap-8', className)}
    >
      <div
        data-testid="carousel-viewport"
        className={cn(
          'relative w-full touch-pan-y overflow-hidden border border-mist bg-pure-white select-none',
          aspectClassName,
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className={cn(
            'flex h-full',
            !dragging && 'transition-transform duration-300 ease-out motion-reduce:transition-none',
          )}
          style={{ transform: `translateX(calc(${String(-index * 100)}% + ${String(dragX)}px))` }}
        >
          {slides.map((slide, i) => (
            <div
              key={i}
              role="group"
              aria-roledescription={t('ui.carousel.slide')}
              aria-label={t('ui.carousel.slideLabel', { n: i + 1, total: count })}
              aria-hidden={i !== index}
              className="h-full w-full shrink-0 [&_img]:pointer-events-none [&_img]:size-full [&_img]:object-cover"
            >
              {slide}
            </div>
          ))}
        </div>

        {multiple && (
          <>
            <Arrow
              direction="previous"
              label={t('ui.carousel.previous')}
              disabled={index === 0}
              onClick={() => {
                go(index - 1);
              }}
            />
            <Arrow
              direction="next"
              label={t('ui.carousel.next')}
              disabled={index === count - 1}
              onClick={() => {
                go(index + 1);
              }}
            />
          </>
        )}
      </div>

      {multiple && (
        <p aria-live="polite" className="text-center font-mono text-sm text-charcoal">
          {t('ui.carousel.indicator', { n: index + 1, total: count })}
        </p>
      )}
    </section>
  );
}
