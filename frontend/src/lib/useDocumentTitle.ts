import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * `Secret Santa · <page>` (or just `Secret Santa`). Pass an already translated title so the
 * tab follows language switches.
 */
export function useDocumentTitle(page?: string): void {
  const { t } = useTranslation();
  const app = t('app.name');
  useEffect(() => {
    document.title = page ? `${app} · ${page}` : app;
  }, [app, page]);
}
