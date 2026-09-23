import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Card, Modal, useToast } from '@/components/ui';
import type { EventDetail } from '@/features/events/api';
import { errorMessage } from '@/lib/errors';

import { useDisableInvite, useRegenerateInvite } from '../api';
import { inviteUrl, useCopyInvite } from '../useCopyInvite';

const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/**
 * Manage › Invite link (FR-INV-2): the URL in mono, Copy, Share (when the Web Share API
 * exists), Regenerate (with a confirm) and Disable / Enable. Once the event isn't OPEN,
 * joining is closed and the card only says so.
 */
export function InviteLinkCard({ event }: { event: EventDetail }) {
  const { t } = useTranslation();
  const toast = useToast();
  const copy = useCopyInvite();
  const regenerate = useRegenerateInvite(event.id);
  const disable = useDisableInvite(event.id);
  const [confirming, setConfirming] = useState(false);
  const token = event.invite_token ?? null;
  const busy = regenerate.isPending || disable.isPending;

  const onError = (error: unknown) => toast.error(errorMessage(t, error));

  let body;
  if (event.state !== 'open') {
    body = <p className="text-body text-charcoal">{t('invites.link.closed')}</p>;
  } else if (token === null) {
    body = (
      <>
        <p className="text-body text-charcoal">{t('invites.link.disabled')}</p>
        <div>
          <Button
            variant="nav"
            loading={regenerate.isPending}
            onClick={() => {
              regenerate.mutate(undefined, {
                onSuccess: () => toast.success(t('invites.link.enabled')),
                onError,
              });
            }}
          >
            {t('invites.link.enable')}
          </Button>
        </div>
      </>
    );
  } else {
    const url = inviteUrl(token);
    body = (
      <>
        <p className="text-sm text-stone">{t('invites.link.help')}</p>
        <p
          className="rounded-2xl border border-mist bg-bone px-19 py-12 font-mono text-sm break-all"
          data-testid="invite-url"
        >
          {url}
        </p>
        <div className="flex flex-wrap gap-10">
          <Button variant="nav" onClick={() => void copy(token)}>
            {t('invites.link.copy')}
          </Button>
          {canShare() && (
            <Button
              variant="nav"
              onClick={() => {
                navigator
                  .share({
                    title: event.name,
                    text: t('invites.link.shareText', { name: event.name }),
                    url,
                  })
                  .catch(() => undefined); // dismissed by the user
              }}
            >
              {t('invites.link.share')}
            </Button>
          )}
          <Button
            variant="nav"
            disabled={busy}
            onClick={() => {
              setConfirming(true);
            }}
          >
            {t('invites.link.regenerate')}
          </Button>
          <Button
            variant="ghost"
            loading={disable.isPending}
            disabled={busy}
            onClick={() => {
              disable.mutate(undefined, {
                onSuccess: () => toast.success(t('invites.link.disabledToast')),
                onError,
              });
            }}
          >
            {t('invites.link.disable')}
          </Button>
        </div>
      </>
    );
  }

  return (
    <Card as="section" aria-labelledby="invite-link" className="flex flex-col gap-12">
      <h2 id="invite-link" className="font-serif text-heading-sm font-medium">
        {t('invites.link.title')}
      </h2>
      {body}
      <Modal
        open={confirming}
        onClose={() => {
          if (!regenerate.isPending) setConfirming(false);
        }}
        title={t('invites.link.regenerateTitle')}
        description={t('invites.link.regenerateBody')}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={regenerate.isPending}
              onClick={() => {
                setConfirming(false);
              }}
            >
              {t('invites.link.cancel')}
            </Button>
            <Button
              variant="secondary"
              loading={regenerate.isPending}
              onClick={() => {
                regenerate.mutate(undefined, {
                  onSuccess: () => {
                    setConfirming(false);
                    toast.success(t('invites.link.regenerated'));
                  },
                  onError: (error) => {
                    setConfirming(false);
                    onError(error);
                  },
                });
              }}
            >
              {t('invites.link.regenerateConfirm')}
            </Button>
          </>
        }
      />
    </Card>
  );
}
