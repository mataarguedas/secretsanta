import { describe, expect, it } from 'vitest';

import i18n from '@/i18n';

import { ApiError } from './apiClient';
import { errorMessage } from './errors';

describe('errorMessage', () => {
  const t = i18n.t.bind(i18n);

  it('translates known codes', () => {
    expect(errorMessage(t, new ApiError('RATE_LIMITED', 429))).toBe(
      'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
    );
  });

  it('falls back to UNKNOWN_ERROR for unknown codes and non-API errors', () => {
    const unknown = 'Ocurrió un error inesperado.';
    expect(errorMessage(t, new ApiError('SOMETHING_NEW', 400))).toBe(unknown);
    expect(errorMessage(t, new Error('boom'))).toBe(unknown);
  });
});
