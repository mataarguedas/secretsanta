import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import i18n from '@/i18n';
import { createQueryClient } from '@/lib/queryClient';

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </I18nextProvider>
  );
}
