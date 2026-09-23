import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Button } from '@/components/ui';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

/**
 * `EVENT_NOT_FOUND`: missing, deleted, or one the user isn't in. The API answers the same
 * for all three, and so does this page (serif headline, one line, one CTA).
 */
export function EventNotFound() {
  const { t } = useTranslation();
  useDocumentTitle(t('events.notFound.title'));
  return (
    <section className="flex flex-col items-start gap-15">
      <h1 className="font-serif text-heading font-medium md:text-heading-lg">
        {t('events.notFound.title')}
      </h1>
      <p className="text-body text-charcoal">{t('events.notFound.body')}</p>
      <Button variant="nav" asChild>
        <Link to="/">{t('events.notFound.cta')}</Link>
      </Button>
    </section>
  );
}
