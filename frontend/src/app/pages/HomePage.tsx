import { useTranslation } from 'react-i18next';

import { useHealth } from '@/lib/health';

// Temporary landing page for the scaffold (Prompt 3). Replaced in Prompt 7.
export function HomePage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1200px] flex-col px-20">
      <header className="flex justify-center py-20">
        <p className="font-serif text-heading-sm font-medium">{t('app.name')}</p>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-15 py-32 text-center md:py-[64px]">
        <p className="font-mono text-sm tracking-[0.056em] text-coral-pop uppercase">
          {t('home.eyebrow')}
        </p>
        <h1 className="font-serif text-heading font-medium md:text-heading-lg">
          {t('home.title')}
        </h1>
        <p className="max-w-[36rem] text-body text-charcoal">{t('home.body')}</p>
        <HealthLine />
      </main>
    </div>
  );
}

function HealthLine() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useHealth();

  let value: string;
  let tone = 'text-charcoal';
  if (isPending) {
    value = t('home.health.loading');
  } else if (isError || data.status !== 'ok') {
    const failing = data
      ? (['db', 'redis'] as const).filter((c) => data[c] !== 'ok').join(', ')
      : '';
    value = failing ? `${t('home.health.error')} (${failing})` : t('home.health.error');
    tone = 'text-error';
  } else {
    value = t('home.health.ok');
    tone = 'text-success';
  }

  return (
    <p className="text-sm text-stone" aria-live="polite" data-testid="health">
      {t('home.health.label')}: <span className={tone}>{value}</span>
    </p>
  );
}
