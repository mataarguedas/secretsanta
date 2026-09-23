import { forwardRef, type SelectHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

import { controlSurface } from './classes';
import { FieldShell, type FieldProps } from './Field';
import { useFieldIds } from './useFieldIds';

export interface SelectProps
  extends FieldProps, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  className?: string;
}

/** Native select (best mobile UX) styled as a pill with a chevron. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    help,
    error,
    className,
    id: idProp,
    'aria-describedby': describedBy,
    children,
    ...props
  },
  ref,
) {
  const ids = useFieldIds(idProp, { help, error }, describedBy);

  return (
    <FieldShell label={label} help={help} error={error} ids={ids} className={className}>
      <div className="relative">
        <select
          ref={ref}
          id={ids.id}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          className={cn(
            controlSurface,
            'cursor-pointer appearance-none rounded-full-2 py-6 pr-40 pl-19',
          )}
          {...props}
        >
          {children}
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="pointer-events-none absolute top-1/2 right-19 size-16 -translate-y-1/2 text-ink-black"
        >
          <path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>
    </FieldShell>
  );
});
