import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui';

/**
 * Shown instead of the whole shell while the session resolves, so neither the signed-out
 * nor the signed-in layout flashes first.
 */
export function FullPageLoading() {
  const { t } = useTranslation();
  return (
    <div role="status" className="flex min-h-dvh items-center justify-center px-16">
      <span
        aria-hidden="true"
        className="animate-pulse font-serif text-heading font-medium motion-reduce:animate-none"
      >
        {t('app.name')}
      </span>
      <span className="sr-only">{t('auth.session.loading')}</span>
    </div>
  );
}

/** The session couldn't be checked (network or server error, not a 401). */
export function FullPageError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-15 px-16 text-center">
      <h1 className="font-serif text-heading font-medium">{t('auth.session.error.title')}</h1>
      <p className="max-w-[36rem] text-body text-charcoal">{t('auth.session.error.body')}</p>
      <Button variant="nav" onClick={onRetry} loading={retrying}>
        {t('auth.session.error.retry')}
      </Button>
    </main>
  );
}
