import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

import type { FieldIds } from './useFieldIds';

export interface FieldProps {
  /** Visible label. Required: every input has a label (PRD §9.4). */
  label: string;
  /** Help text under the control. */
  help?: ReactNode;
  /** Inline error; also sets aria-invalid on the control. */
  error?: ReactNode;
}

/** Label + control + help + inline error, shared by Input, Textarea and Select. */
export function FieldShell({
  label,
  help,
  error,
  ids,
  className,
  children,
}: FieldProps & { ids: FieldIds; className?: string | undefined; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <label htmlFor={ids.id} className="text-sm text-charcoal">
        {label}
      </label>
      {children}
      {help && (
        <p id={ids.helpId} className="text-sm text-stone">
          {help}
        </p>
      )}
      {error && (
        <p id={ids.errorId} className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
