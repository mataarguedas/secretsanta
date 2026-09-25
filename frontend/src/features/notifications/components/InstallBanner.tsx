import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Card } from '@/components/ui';

import { promptInstall, useInstallPrompt } from '../installPrompt';
import { usePushSupport } from '../support';
import { IosInstallGuide } from './IosInstallGuide';

const DISMISSED_KEY = 'santa:install-banner-dismissed';

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false; // storage blocked: the banner just comes back next time
  }
}

function rememberDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // ignore: see wasDismissed
  }
}

/** A plain ×, for the icon-only dismiss button. */
function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-20" fill="none">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Dashboard install invitation (FR-PWA-3): a content Card (never the coral Banner, which
 * the dashboard doesn't need). Android/desktop get the browser's own install dialog; iOS
 * Safari gets the Add to Home Screen guide. Nothing when already installed, when the
 * browser can't install, or once dismissed (remembered on this device).
 */
export function InstallBanner() {
  const { t } = useTranslation();
  const headingId = useId();
  const { ios, standalone } = usePushSupport();
  const { canPrompt, installed } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(wasDismissed);
  const [guideOpen, setGuideOpen] = useState(false);

  const iosGuide = ios && !standalone;
  if (dismissed || standalone || installed || !(canPrompt || iosGuide)) return null;

  return (
    <Card as="section" aria-labelledby={headingId} className="flex items-start gap-15">
      <div className="flex min-w-0 flex-1 flex-col gap-10">
        <h2 id={headingId} className="font-serif text-subheading font-medium">
          {t('notifications.install.title')}
        </h2>
        <p className="text-body text-charcoal">
          {t(iosGuide ? 'notifications.install.bodyIos' : 'notifications.install.body')}
        </p>
        <div>
          {iosGuide ? (
            <Button
              variant="nav"
              onClick={() => {
                setGuideOpen(true);
              }}
            >
              {t('notifications.install.howTo')}
            </Button>
          ) : (
            <Button
              variant="nav"
              onClick={() => {
                void promptInstall();
              }}
            >
              {t('notifications.install.action')}
            </Button>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        iconOnly
        aria-label={t('notifications.install.dismiss')}
        onClick={() => {
          rememberDismissed();
          setDismissed(true);
        }}
      >
        <CloseIcon />
      </Button>
      <IosInstallGuide
        open={guideOpen}
        onClose={() => {
          setGuideOpen(false);
        }}
      />
    </Card>
  );
}
