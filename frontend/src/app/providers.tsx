import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import { ToastProvider } from '@/components/ui';
import { bindSessionToQueryClient } from '@/features/auth/api';
import i18n from '@/i18n';
import { apiClient } from '@/lib/apiClient';
import { createQueryClient } from '@/lib/queryClient';

export function AppProviders({
  children,
  queryClient: injected,
}: {
  children: ReactNode;
  /** Tests pass their own client; the app creates one. */
  queryClient?: QueryClient;
}) {
  const [queryClient] = useState(() => injected ?? createQueryClient());

  // A failed refresh anywhere marks the session signed out (CLAUDE.md §8).
  useEffect(() => bindSessionToQueryClient(apiClient, queryClient), [queryClient]);

  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
