import { useTranslation } from 'react-i18next';

/** Shown once notifications are blocked: the browser won't ask again, so say how to undo it. */
export function BlockedInstructions() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="text-body text-error">
        {t('notifications.blocked.title')}
      </p>
      <p className="text-body text-charcoal">{t('notifications.blocked.howTo')}</p>
    </div>
  );
}
