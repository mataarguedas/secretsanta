import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { controlSurface } from './classes';
import { FieldShell, type FieldProps } from './Field';
import { useFieldIds } from './useFieldIds';

export interface InputProps
  extends FieldProps, Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'prefix'> {
  /** Adornment before the value, e.g. "₡" for money fields. */
  prefix?: ReactNode;
  className?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, help, error, prefix, className, id: idProp, 'aria-describedby': describedBy, ...props },
  ref,
) {
  const ids = useFieldIds(idProp, { help, error }, describedBy);

  return (
    <FieldShell label={label} help={help} error={error} ids={ids} className={className}>
      <div
        className={cn(
          controlSurface,
          // The focus ring goes on the pill wrapper so it includes the prefix.
          'flex items-center gap-8 rounded-full-2 px-19 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink-black',
          props.disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        {prefix && <span className="text-charcoal">{prefix}</span>}
        <input
          ref={ref}
          id={ids.id}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          className="min-w-0 flex-1 bg-transparent py-6 font-mono text-body text-ink-black outline-none placeholder:text-stone disabled:cursor-not-allowed"
          {...props}
        />
      </div>
    </FieldShell>
  );
});
