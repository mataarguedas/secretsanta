import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export type PillTone = 'neutral' | 'outline';

const TONE_CLASSES: Record<PillTone, string> = {
  // Non-interactive chips never use the black border, which signals "clickable".
  neutral: 'bg-bone text-charcoal',
  outline: 'border border-mist bg-pure-white text-charcoal',
};

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
}

/** Non-interactive chip/tag (priority chips, counts). */
export function Pill({ tone = 'neutral', className, ...props }: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-6 rounded-full-2 px-12 py-6 text-sm leading-none whitespace-nowrap',
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    />
  );
}

export interface PillToggleProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-pressed' | 'onChange'
> {
  pressed: boolean;
  onPressedChange?: (pressed: boolean) => void;
}

/** Interactive pill with a pressed state (segmented choices, filters). */
export const PillToggle = forwardRef<HTMLButtonElement, PillToggleProps>(function PillToggle(
  { pressed, onPressedChange, onClick, className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={pressed}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onPressedChange?.(!pressed);
      }}
      className={cn(
        'inline-flex min-h-11 cursor-pointer items-center justify-center gap-6 rounded-full-2 border border-ink-black px-19 py-6 text-sm whitespace-nowrap transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        pressed
          ? 'bg-ink-black text-pure-white'
          : 'bg-transparent text-ink-black hover:bg-pure-white',
        className,
      )}
      {...props}
    />
  );
});
