import { useTranslation } from 'react-i18next';

import { PillToggle, useToast } from '@/components/ui';
import { SUPPORTED_LANGUAGES, type Language } from '@/i18n';
import { errorMessage } from '@/lib/errors';

import { useUpdateMe } from '../api';

/**
 * Español / English segmented pills (FR-ACC-2). The switch is instant: the language
 * changes before the request, `PATCH /me` persists it, and the confirmation toast is in
 * the *new* language. A failure restores the previous language and says so in it.
 */
export function LanguageSetting({ locale }: { locale: Language }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const update = useUpdateMe();

  function choose(next: Language) {
    if (next === locale) return;
    const previous = locale;
    void i18n.changeLanguage(next);
    update.mutate(
      { locale: next },
      {
        onSuccess: () => {
          toast.success(i18n.getFixedT(next)('profile.language.saved'));
        },
        onError: (error) => {
          void i18n.changeLanguage(previous);
          toast.error(errorMessage(i18n.getFixedT(previous), error));
        },
      },
    );
  }

  return (
    <div role="group" aria-label={t('profile.language.title')} className="flex flex-wrap gap-10">
      {SUPPORTED_LANGUAGES.map((lng) => (
        <PillToggle
          key={lng}
          lang={lng}
          pressed={locale === lng}
          onPressedChange={() => {
            choose(lng);
          }}
        >
          {t(`profile.language.options.${lng}`)}
        </PillToggle>
      ))}
    </div>
  );
}
