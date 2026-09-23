import { forwardRef, useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'role' | 'aria-checked' | 'children' | 'defaultChecked' | 'className'
> {
  label: string;
  /** Secondary line under the label. */
  description?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
}

/** Pill-shaped on/off switch (`role="switch"`) with a visible, clickable label. */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  {
    label,
    description,
    checked: checkedProp,
    defaultChecked = false,
    onCheckedChange,
    onClick,
    id: idProp,
    disabled,
    className,
    ...props
  },
  ref,
) {
  const generated = useId();
  const id = idProp ?? generated;
  const descriptionId = description ? `${id}-description` : undefined;
  const [uncontrolled, setUncontrolled] = useState(defaultChecked);
  const checked = checkedProp ?? uncontrolled;

  return (
    <div className={cn('flex min-h-11 items-center justify-between gap-15', className)}>
      <div className="flex flex-col gap-6">
        <label htmlFor={id} className={cn('text-body', !disabled && 'cursor-pointer')}>
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="text-sm text-stone">
            {description}
          </p>
        )}
      </div>
      <button
        ref={ref}
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={(e) => {
          onClick?.(e);
          if (e.defaultPrevented) return;
          if (checkedProp === undefined) setUncontrolled(!checked);
          onCheckedChange?.(!checked);
        }}
        className={cn(
          // 48×28 pill track; the ::after box extends the hit target to 64×44.
          "relative h-[28px] w-[48px] shrink-0 cursor-pointer rounded-full-2 border border-ink-black transition-colors after:absolute after:-inset-[8px] after:content-['']",
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-ink-black' : 'bg-bone',
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-[3px] left-[3px] size-[20px] rounded-full-2 border border-ink-black bg-pure-white transition-transform',
            checked && 'translate-x-[20px]',
          )}
        />
      </button>
    </div>
  );
});
