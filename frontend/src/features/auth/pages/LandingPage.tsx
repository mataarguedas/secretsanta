import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { Button } from '@/components/ui';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

import { googleLoginUrl } from '../next';

const ERROR_CODE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Signed-out `/` (PRD §9.3.1): a serif headline, one sans line and the single coral
 * "Continue with Google" pill. `?next=` is carried into the login URL; `?auth_error=` (set
 * by the OAuth callback on failure) shows as status text above the pill.
 */
export function LandingPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const authError = params.get('auth_error');

  useDocumentTitle();

  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-20 py-32 text-center">
      <h1 className="max-w-[16ch] font-serif text-heading-lg font-medium md:text-display">
        {t('auth.landing.title')}
      </h1>
      <p className="max-w-[36rem] text-body text-charcoal md:text-body-lg">
        {t('auth.landing.body')}
      </p>
      {authError && ERROR_CODE.test(authError) && (
        <p role="alert" className="text-sm text-error">
          {t(`errors.${authError}` as 'errors.AUTH_OAUTH_FAILED', {
            defaultValue: t('errors.UNKNOWN_ERROR'),
          })}
        </p>
      )}
      <Button variant="primary" asChild>
        <a href={googleLoginUrl(params.get('next'))}>{t('auth.landing.cta')}</a>
      </Button>
    </section>
  );
}
