import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Input, Modal, useToast } from '@/components/ui';
import { ApiError } from '@/lib/apiClient';
import { errorMessage } from '@/lib/errors';

import { useDeleteAccount, useDeletionPreview, type DeletionPreview } from '../api';

/**
 * Profile › Delete account (FR-ACC-3): a secondary pill, never coral. The dialog loads what
 * deleting would do: blocked by DRAWN events (explained, no delete action), or the hosted
 * OPEN events that go too, then a typed confirmation word before the destructive button
 * is enabled.
 */
export function DeleteAccountSection() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <p className="text-body text-charcoal">{t('profile.delete.body')}</p>
      <div>
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(true);
          }}
        >
          {t('profile.delete.open')}
        </Button>
      </div>
      {open && (
        <DeleteAccountDialog
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const preview = useDeletionPreview(true);
  const remove = useDeleteAccount();
  const toast = useToast();
  const [typed, setTyped] = useState('');

  const word = t('profile.delete.confirmWord');
  const confirmed = typed.trim().toLocaleUpperCase() === word.toLocaleUpperCase();
  const ready = preview.isSuccess && !preview.data.blocked;
  const close = () => {
    if (!remove.isPending) onClose();
  };

  const cancel = (
    <Button variant="ghost" disabled={remove.isPending} onClick={close}>
      {ready ? t('profile.delete.cancel') : t('profile.delete.close')}
    </Button>
  );

  return (
    <Modal
      open
      onClose={close}
      title={t('profile.delete.title')}
      footer={
        ready ? (
          <>
            {cancel}
            <Button
              variant="secondary"
              disabled={!confirmed}
              loading={remove.isPending}
              onClick={() => {
                remove.mutate(undefined, {
                  onSuccess: () => toast.success(t('profile.delete.done')),
                  onError: (error) => {
                    toast.error(errorMessage(t, error));
                    // e.g. a draw happened meanwhile: show why it's blocked now.
                    if (error instanceof ApiError && error.code === 'ACCOUNT_IN_ACTIVE_DRAW') {
                      void preview.refetch();
                    }
                  },
                });
              }}
            >
              {t('profile.delete.confirm')}
            </Button>
          </>
        ) : (
          cancel
        )
      }
    >
      {preview.isPending && (
        <p role="status" className="text-body text-stone">
          {t('profile.delete.loading')}
        </p>
      )}
      {preview.isError && (
        <div className="flex flex-col items-start gap-12">
          <p className="text-body text-error">{errorMessage(t, preview.error)}</p>
          <Button variant="nav" onClick={() => void preview.refetch()}>
            {t('profile.delete.retry')}
          </Button>
        </div>
      )}
      {preview.isSuccess &&
        (preview.data.blocked ? (
          <Blocked preview={preview.data} />
        ) : (
          <div className="flex flex-col gap-15">
            <p className="text-body text-charcoal">{t('profile.delete.warning')}</p>
            <HostedEvents preview={preview.data} />
            <Input
              label={t('profile.delete.typeLabel', { word })}
              value={typed}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={remove.isPending}
              onChange={(e) => {
                setTyped(e.target.value);
              }}
            />
          </div>
        ))}
    </Modal>
  );
}

function Blocked({ preview }: { preview: DeletionPreview }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-12">
      <p className="text-body text-charcoal">{t('profile.delete.blocked')}</p>
      <ul aria-label={t('profile.delete.blockingLabel')} className="flex flex-col gap-6">
        {preview.blocking_events.map((event) => (
          <li key={event.id} className="font-serif text-subheading font-medium break-words">
            {event.name}
          </li>
        ))}
      </ul>
      <p className="text-sm text-stone">{t('profile.delete.blockedHint')}</p>
    </div>
  );
}

function HostedEvents({ preview }: { preview: DeletionPreview }) {
  const { t } = useTranslation();
  if (preview.hosted_open_events.length === 0) return null;
  return (
    <div className="flex flex-col gap-8">
      <p className="text-body text-charcoal">{t('profile.delete.hostedIntro')}</p>
      <ul aria-label={t('profile.delete.hostedLabel')} className="flex flex-col gap-6">
        {preview.hosted_open_events.map((event) => (
          <li key={event.id} className="flex flex-wrap items-baseline gap-x-12">
            <span className="font-serif text-subheading font-medium break-words">{event.name}</span>
            <span className="text-sm text-stone">
              {t('events.card.participants', { count: event.participant_count })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
