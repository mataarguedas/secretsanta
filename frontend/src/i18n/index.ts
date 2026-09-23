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

/** `en*` → `en`; anything else (including `es-CR`) → `es` (FR-AUTH-2, FR-I18N-1). */
export function detectLanguage(
  languages: readonly string[] | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language],
): Language {
  const first = languages?.[0]?.toLowerCase() ?? '';
  return first === 'en' || first.startsWith('en-') ? 'en' : DEFAULT_LANGUAGE;
}

function syncHtmlLang(lng: string): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng;
  }
}

i18n.on('languageChanged', syncHtmlLang);

void i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,
  interpolation: { escapeValue: false }, // React already escapes.
});

syncHtmlLang(i18n.language);

export default i18n;
