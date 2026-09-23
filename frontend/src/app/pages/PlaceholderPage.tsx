import type { ParseKeys } from 'i18next';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/** Temporary page for routes built in later prompts: a serif title and one line. */
export function PlaceholderPage({ titleKey }: { titleKey: ParseKeys }) {
  const { t } = useTranslation();
  const title = t(titleKey);

  useEffect(() => {
    document.title = `${title} · ${t('app.name')}`;
  }, [title, t]);

  return (
    <section className="flex flex-col gap-15">
      <h1 className="font-serif text-heading font-medium md:text-heading-lg">{title}</h1>
      <p className="text-body text-charcoal">{t('app.placeholder')}</p>
    </section>
  );
}
