import type { TFunction } from 'i18next';

import { ApiError } from './apiClient';

/** Map any thrown value to a translated message via `errors.<CODE>` (CLAUDE.md §8). */
export function errorMessage(t: TFunction, error: unknown): string {
  return codeMessage(t, error instanceof ApiError ? error.code : 'UNKNOWN_ERROR');
}

/** A bare error code (e.g. from a WebSocket `error` frame) → its translated message. */
export function codeMessage(t: TFunction, code: string): string {
  return t(`errors.${code}`, { defaultValue: t('errors.UNKNOWN_ERROR') });
}
