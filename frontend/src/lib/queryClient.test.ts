import { describe, expect, it } from 'vitest';

import { ApiError } from './apiClient';
import { shouldRetry } from './queryClient';

describe('shouldRetry', () => {
  it('never retries a 4xx (the answer will not change)', () => {
    expect(shouldRetry(0, new ApiError('UNAUTHENTICATED', 401))).toBe(false);
    expect(shouldRetry(0, new ApiError('NOT_FOUND', 404))).toBe(false);
  });

  it('retries network and server errors once', () => {
    expect(shouldRetry(0, new ApiError('NETWORK_ERROR', 0))).toBe(true);
    expect(shouldRetry(0, new ApiError('INTERNAL_ERROR', 500))).toBe(true);
    expect(shouldRetry(1, new ApiError('INTERNAL_ERROR', 500))).toBe(false);
  });
});
