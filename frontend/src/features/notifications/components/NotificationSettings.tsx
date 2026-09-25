import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, useToast } from '@/components/ui';
import { errorMessage } from '@/lib/errors';

import { thisDeviceId, useDevices, useSendTestPush } from '../api';
import { usePushSupport } from '../support';
import { EnableNotificationsButton } from './EnableNotificationsButton';
import { IosInstallGuide } from './IosInstallGuide';

/** The dev-only test push. `import.meta.env.PROD` is statically true in production builds. */
const TEST_PUSH_AVAILABLE = !import.meta.env.PROD;

/**
 * Profile › Notifications (FR-NTF-9, PRD §9.3.8): this device's state and the one way to
 * change it. iOS in a browser tab → the install guide; blocked → how to unblock; on and
 * registered → a confirmation (and, outside production, "Send test notification").
 */
export function NotificationSettings() {
  const { t } = useTranslation();
  const { mode } = usePushSupport();
  const devices = useDevices();
  const [guideOpen, setGuideOpen] = useState(false);

  const current = thisDeviceId();
  const onHere = mode === 'granted' && devices.data?.some((d) => d.id === current) === true;

  let body;
  if (mode === 'ios-install') {
    body = (
      <>
        <p className="text-body text-charcoal">{t('notifications.ios.body')}</p>
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setGuideOpen(true);
            }}
          >
            {t('notifications.ios.action')}
          </Button>
        </div>
        <IosInstallGuide
          open={guideOpen}
          onClose={() => {
            setGuideOpen(false);
          }}
        />
      </>
    );
  } else if (mode === 'unsupported') {
    body = <p className="text-body text-charcoal">{t('notifications.unsupported')}</p>;
  } else if (onHere) {
    body = <p className="text-body text-charcoal">{t('notifications.enabledHere')}</p>;
  } else {
    body = (
      <>
        <p className="text-body text-charcoal">{t('notifications.intro')}</p>
        <EnableNotificationsButton />
      </>
    );
  }

  return (
    <>
      {body}
      {/* TODO(prompt 25): the per-type toggles (message, wishlist_updated, exchange_reminder). */}
      {TEST_PUSH_AVAILABLE && (devices.data?.length ?? 0) > 0 && <SendTestPush />}
    </>
  );
}

function SendTestPush() {
  const { t } = useTranslation();
  const toast = useToast();
  const send = useSendTestPush();
  return (
    <div>
      <Button
        variant="nav"
        loading={send.isPending}
        onClick={() => {
          send.mutate(undefined, {
            onSuccess: () => {
              toast.info(t('notifications.test.sent'));
            },
            onError: (error) => toast.error(errorMessage(t, error)),
          });
        }}
      >
        {t('notifications.test.action')}
      </Button>
    </div>
  );
}
