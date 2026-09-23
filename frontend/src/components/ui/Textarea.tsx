import { forwardRef, type TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

import { controlSurface } from './classes';
import { FieldShell, type FieldProps } from './Field';
import { useFieldIds } from './useFieldIds';

export interface TextareaProps
  extends FieldProps, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  className?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    help,
    error,
    className,
    id: idProp,
    'aria-describedby': describedBy,
    rows = 4,
    ...props
  },
  ref,
) {
  const ids = useFieldIds(idProp, { help, error }, describedBy);

  return (
    <FieldShell label={label} help={help} error={error} ids={ids} className={className}>
      <textarea
        ref={ref}
        id={ids.id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        // Multi-line text can't be a 999px pill; it uses the DESIGN.md 20px nav radius.
        className={cn(controlSurface, 'block resize-y rounded-2xl px-19 py-12')}
        {...props}
      />
    </FieldShell>
  );
});
