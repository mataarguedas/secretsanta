import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './apiClient';

/** Retrying a 4xx can't change the answer; network and 5xx errors get one more try. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: shouldRetry },
    },
  });
}
