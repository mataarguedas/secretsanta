import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'nav' | 'ghost';

/**
 * CLAUDE.md §6.2 button variants. `primary` is the coral fill: at most one per viewport.
 * Its text is 18px (contrast mitigation, PRD §9.4).
 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-coral-pop text-body-lg text-pure-white hover:bg-terracotta-whisper',
  secondary:
    'border border-terracotta-whisper text-body text-terracotta-whisper hover:bg-pure-white',
  nav: 'border border-ink-black text-sm text-ink-black hover:bg-pure-white',
  ghost: 'text-body text-ink-black underline-offset-4 hover:underline',
};

export function buttonClasses({
  variant,
  iconOnly = false,
  fullWidthOnMobile = false,
  className,
}: {
  variant: ButtonVariant;
  iconOnly?: boolean;
  fullWidthOnMobile?: boolean;
  className?: string | undefined;
}): string {
  return cn(
    // Every clickable is a pill (999px), 6px × 19px, content-sized, ≥ 44px hit target.
    'inline-flex min-h-11 cursor-pointer items-center justify-center gap-8 rounded-full-2 font-sans font-normal tracking-[0.028em] whitespace-nowrap transition-colors select-none',
    'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
    iconOnly ? 'size-11 p-0' : 'px-19 py-6',
    fullWidthOnMobile ? 'w-full md:w-auto' : 'w-auto',
    VARIANT_CLASSES[variant],
    className,
  );
}

export type CardVariant = 'content' | 'interactive';

export function cardClasses(variant: CardVariant, className?: string): string {
  return cn(
    // White surface, square corners, 1px border, 20px padding. Never a shadow.
    'block rounded-none border bg-pure-white p-20',
    variant === 'interactive'
      ? 'cursor-pointer border-ink-black transition-colors hover:bg-cream-linen'
      : 'border-mist',
    className,
  );
}

/** Pill control surface: bone background, black hairline, mono text (DESIGN.md inputs). */
export const controlSurface =
  'min-h-11 w-full border border-ink-black bg-bone font-mono text-body text-ink-black placeholder:text-stone disabled:cursor-not-allowed disabled:opacity-50';
