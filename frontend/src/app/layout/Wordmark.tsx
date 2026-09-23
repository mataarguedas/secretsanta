import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { cn } from '@/lib/cn';

/** Centered "Secret Santa" serif wordmark (placeholder until the logo exists). */
export function Wordmark({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Link
      to="/"
      aria-label={t('nav.home')}
      className={cn(
        'inline-flex min-h-11 items-center rounded-full-2 px-12 font-serif font-medium whitespace-nowrap',
        className,
      )}
    >
      {t('app.name')}
    </Link>
  );
}
