import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './en.json';
import es from './es.json';

export const SUPPORTED_LANGUAGES = ['es', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'es';

export const resources = {
  es: { translation: es },
  en: { translation: en },
} as const;

function syncHtmlLang(lng: string): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng;
  }
}

i18n.on('languageChanged', syncHtmlLang);

// Always Spanish to start, whatever the browser's language. Once signed in, the saved
// locale takes over (useSyncLocale); users switch in Profile › Language.
void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,
  interpolation: { escapeValue: false }, // React already escapes.
});

syncHtmlLang(i18n.language);

export default i18n;
