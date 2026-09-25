import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, useToast } from '@/components/ui';
import { ApiError } from '@/lib/apiClient';
import { errorMessage } from '@/lib/errors';

import { useSubscribeThisDevice } from '../api';
import { refreshPushSupport, usePushSupport } from '../support';
import { BlockedInstructions } from './BlockedInstructions';

/**
 * "Enable notifications" (FR-NTF-9). The permission prompt is only ever triggered from
 * this click (iOS requires it, and prompting on load is hostile): request permission,
 * then subscribe with the VAPID key and register the device. A "denied" answer, now or
 * from before, shows how to unblock instead of a button that can't work.
 */
export function EnableNotificationsButton() {
  const { t } = useTranslation();
  const toast = useToast();
  const { permission } = usePushSupport();
  const subscribe = useSubscribeThisDevice();
  const [asking, setAsking] = useState(false);

  if (permission === 'denied') return <BlockedInstructions />;

  async function enable() {
    setAsking(true);
    let result: NotificationPermission;
    try {
      result = await Notification.requestPermission();
    } finally {
      setAsking(false);
      refreshPushSupport();
    }
    if (result !== 'granted') return; // denied → instructions; dismissed → ask again later
    subscribe.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('notifications.enable.success'));
      },
      onError: (error) => {
        toast.error(
          error instanceof ApiError ? errorMessage(t, error) : t('notifications.enable.failed'),
        );
      },
    });
  }

  return (
    <div>
      <Button
        variant="primary"
        loading={asking || subscribe.isPending}
        onClick={() => {
          void enable();
        }}
      >
        {t('notifications.enable.action')}
      </Button>
    </div>
  );
}
