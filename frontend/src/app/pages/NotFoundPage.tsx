import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Button } from '@/components/ui';

/** Typographic empty state: serif headline, one line, one CTA. */
export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col items-start gap-15">
      <h1 className="font-serif text-heading font-medium md:text-heading-lg">
        {t('app.notFound.title')}
      </h1>
      <p className="text-body text-charcoal">{t('app.notFound.body')}</p>
      <Button variant="nav" asChild>
        <Link to="/">{t('app.notFound.cta')}</Link>
      </Button>
    </section>
  );
}
