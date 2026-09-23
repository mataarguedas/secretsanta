import { useQuery } from '@tanstack/react-query';

import { apiClient } from './apiClient';

export type ComponentStatus = 'ok' | 'error';

export interface HealthResponse {
  status: ComponentStatus;
  db: ComponentStatus;
  redis: ComponentStatus;
}

export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  // 503 still carries a HealthResponse body naming the failing component.
  return apiClient.get<HealthResponse>('/health', {
    allowStatus: [503],
    ...(signal ? { signal } : {}),
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => fetchHealth(signal),
    retry: false,
    refetchOnWindowFocus: false,
  });
}
