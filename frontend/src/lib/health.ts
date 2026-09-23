import { useQuery } from '@tanstack/react-query';

export type ComponentStatus = 'ok' | 'error';

export interface HealthResponse {
  status: ComponentStatus;
  db: ComponentStatus;
  redis: ComponentStatus;
}

// TODO(prompt 5): switch to lib/apiClient once it exists.
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch('/api/v1/health', {
    credentials: 'include',
    headers: { Accept: 'application/json', 'X-Requested-With': 'fetch' },
    signal: signal ?? null,
  });
  // 503 still carries a HealthResponse body naming the failing component.
  if (res.status !== 200 && res.status !== 503) {
    throw new Error(`health: HTTP ${String(res.status)}`);
  }
  return (await res.json()) as HealthResponse;
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => fetchHealth(signal),
    retry: false,
    refetchOnWindowFocus: false,
  });
}
