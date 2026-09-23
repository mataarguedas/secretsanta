import { useId } from 'react';

import type { FieldProps } from './Field';

export interface FieldIds {
  id: string;
  helpId: string | undefined;
  errorId: string | undefined;
  describedBy: string | undefined;
}

export function useFieldIds(
  idProp: string | undefined,
  { help, error }: Pick<FieldProps, 'help' | 'error'>,
  ariaDescribedBy?: string,
): FieldIds {
  const generated = useId();
  const id = idProp ?? generated;
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [ariaDescribedBy, helpId, errorId].filter(Boolean).join(' ') || undefined;
  return { id, helpId, errorId, describedBy };
}
