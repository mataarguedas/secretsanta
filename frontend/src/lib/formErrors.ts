import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { ApiError } from './apiClient';

interface ServerFieldError {
  loc?: unknown;
}

/** `VALIDATION_ERROR` details: `{ params: { fields: [{ loc: ['body', 'exchange_at'], … }] } }`. */
function serverFields(error: ApiError): string[] {
  const params = error.details.params as { fields?: ServerFieldError[] } | undefined;
  return (params?.fields ?? [])
    .map(({ loc }): unknown => {
      const path = Array.isArray(loc) ? (loc as unknown[]) : [];
      return path[0] === 'body' ? path[1] : undefined;
    })
    .filter((name): name is string => typeof name === 'string');
}

/**
 * Put a server validation error on the matching inputs. Returns false when nothing could be
 * mapped (another code, or a whole-body error), so the caller shows a toast instead.
 */
export function applyServerFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fieldMap: Record<string, Path<T>>,
  message: string,
): boolean {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR') return false;
  const fields = serverFields(error)
    .map((name) => fieldMap[name])
    .filter((field): field is Path<T> => field !== undefined);
  fields.forEach((field, index) => {
    setError(field, { type: 'server', message }, { shouldFocus: index === 0 });
  });
  return fields.length > 0;
}
