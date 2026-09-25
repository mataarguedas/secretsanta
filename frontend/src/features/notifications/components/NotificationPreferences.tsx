import { useTranslation } from 'react-i18next';

import { Switch, useToast } from '@/components/ui';
import { useMe, type Me } from '@/features/auth/api';
import { useUpdateMe } from '@/features/profile/api';
import { errorMessage } from '@/lib/errors';

type Preference = keyof Pick<Me, 'notify_message' | 'notify_wishlist' | 'notify_reminder'>;

const PREFERENCES: readonly {
  field: Preference;
  key: 'messages' | 'wishlist' | 'reminders';
}[] = [
  { field: 'notify_message', key: 'messages' },
  { field: 'notify_wishlist', key: 'wishlist' },
  { field: 'notify_reminder', key: 'reminders' },
];

/**
 * What to be notified about (FR-NTF-3), for every device of the account. Each switch is
 * an optimistic `PATCH /me` (rolled back on failure). The reveal is always on: it's shown
 * checked and disabled, with the reason.
 */
export function NotificationPreferences() {
  const { t } = useTranslation();
  const toast = useToast();
  const { data: me } = useMe();
  const update = useUpdateMe();
  if (!me) return null;

  return (
    <div
      role="group"
      aria-label={t('notifications.preferences.title')}
      className="flex flex-col gap-10 border-t border-mist pt-15"
    >
      <Switch
        label={t('notifications.preferences.reveal.label')}
        description={t('notifications.preferences.reveal.description')}
        checked
        disabled
      />
      {PREFERENCES.map(({ field, key }) => (
        <Switch
          key={field}
          label={t(`notifications.preferences.${key}.label`)}
          description={t(`notifications.preferences.${key}.description`)}
          checked={me[field]}
          onCheckedChange={(checked) => {
            update.mutate(
              { [field]: checked },
              { onError: (error) => toast.error(errorMessage(t, error)) },
            );
          }}
        />
      ))}
    </div>
  );
}
