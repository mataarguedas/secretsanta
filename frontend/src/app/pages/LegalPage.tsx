import { useTranslation } from 'react-i18next';

import { Card, Eyebrow } from '@/components/ui';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

export type LegalDoc = 'privacy' | 'terms';

/** The sections of each page, in order (keys under `legal.<doc>.sections`). */
const SECTIONS: Record<LegalDoc, readonly string[]> = {
  privacy: ['collect', 'use', 'visibility', 'storage', 'deletion', 'contact'],
  terms: ['use', 'content', 'events', 'availability', 'changes'],
};

/**
 * `/privacy` and `/terms` (FR-ACC-4): public, localized placeholder text until the final
 * legal copy exists (CLAUDE.md §13). A serif title, a clear "placeholder" notice, then a
 * few short sections.
 */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  const { t } = useTranslation();
  const title = t(`legal.${doc}.title`);
  useDocumentTitle(title);

  return (
    <article className="flex max-w-[720px] flex-col gap-32">
      <header className="flex flex-col gap-12">
        <h1 className="font-serif text-heading font-medium md:text-heading-lg">{title}</h1>
        <p className="text-sm text-stone">{t('legal.updated')}</p>
      </header>
      <Card role="note" className="flex flex-col gap-6">
        <Eyebrow as="p">{t('legal.placeholder.eyebrow')}</Eyebrow>
        <p className="text-body text-charcoal">{t('legal.placeholder.body')}</p>
      </Card>
      {SECTIONS[doc].map((section) => (
        <section key={section} aria-labelledby={`legal-${section}`} className="flex flex-col gap-8">
          <h2 id={`legal-${section}`} className="font-serif text-heading-sm font-medium">
            {t(`legal.${doc}.sections.${section}.title` as 'legal.privacy.title')}
          </h2>
          <p className="text-body text-charcoal">
            {t(`legal.${doc}.sections.${section}.body` as 'legal.privacy.title')}
          </p>
        </section>
      ))}
    </article>
  );
}
