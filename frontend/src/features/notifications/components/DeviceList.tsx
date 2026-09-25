import { useTranslation } from 'react-i18next';

import { Button, Pill, useToast } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatRelative } from '@/lib/format';

import { thisDeviceId, useDevices, useRemoveDevice, type PushDevice } from '../api';

/** "Chrome on Windows" in the viewer's language; the backend only names the parts. */
function useDeviceName() {
  const { t } = useTranslation();
  return (device: PushDevice) => {
    const browser = device.browser ?? t('notifications.devices.unknownBrowser');
    return device.os ? t('notifications.devices.name', { browser, os: device.os }) : browser;
  };
}

/**
 * Profile › Devices (FR-ACC-2, FR-NTF-10): every browser that gets my pushes, each with a
 * Remove pill. Removing this browser also unsubscribes it here.
 */
export function DeviceList() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const devices = useDevices();
  const remove = useRemoveDevice();
  const nameOf = useDeviceName();
  const current = thisDeviceId();

  if (devices.isPending) {
    return (
      <p role="status" className="text-body text-stone">
        {t('notifications.devices.loading')}
      </p>
    );
  }
  if (devices.isError) {
    return (
      <div className="flex flex-wrap items-center gap-15">
        <p className="text-body text-error">{t('notifications.devices.error')}</p>
        <Button variant="nav" onClick={() => void devices.refetch()}>
          {t('notifications.devices.retry')}
        </Button>
      </div>
    );
  }
  if (devices.data.length === 0) {
    return <p className="text-body text-charcoal">{t('notifications.devices.empty')}</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-mist">
      {devices.data.map((device) => {
        const name = nameOf(device);
        const lastSent = device.last_success_at
          ? (formatRelative(device.last_success_at, i18n.language) ??
            t('notifications.devices.justNow'))
          : null;
        return (
          <li
            key={device.id}
            className="flex flex-wrap items-center justify-between gap-12 py-12 first:pt-0 last:pb-0"
          >
            <div className="flex min-w-0 flex-col gap-6">
              <p className="flex flex-wrap items-center gap-10 text-body">
                {name}
                {device.id === current && (
                  <Pill tone="outline">{t('notifications.devices.thisDevice')}</Pill>
                )}
              </p>
              <p className="text-sm text-stone">
                {t('notifications.devices.added', {
                  date: formatDate(device.created_at, i18n.language),
                })}
                {lastSent && ` · ${t('notifications.devices.lastSent', { when: lastSent })}`}
              </p>
            </div>
            <Button
              variant="nav"
              aria-label={t('notifications.devices.removeNamed', { name })}
              loading={remove.isPending && remove.variables === device.id}
              onClick={() => {
                remove.mutate(device.id, {
                  onSuccess: () => {
                    toast.success(t('notifications.devices.removed'));
                  },
                  onError: (error) => toast.error(errorMessage(t, error)),
                });
              }}
            >
              {t('notifications.devices.remove')}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
