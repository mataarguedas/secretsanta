import { useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';

import type { Language } from '@/i18n';

/**
 * Signed-in users see their saved locale, whatever the browser says. A layout effect so
 * the switch lands before the first paint of the shell (resources are bundled, so
 * `changeLanguage` settles synchronously).
 */
export function useSyncLocale(locale: Language | undefined): void {
  const { i18n } = useTranslation();
  useLayoutEffect(() => {
    if (locale && i18n.language !== locale) void i18n.changeLanguage(locale);
  }, [locale, i18n]);
}
