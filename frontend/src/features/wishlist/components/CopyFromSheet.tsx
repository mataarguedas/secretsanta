import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, PillToggle, Sheet, useToast } from '@/components/ui';
import { errorMessage } from '@/lib/errors';

import { useCopyFrom, useCopySources } from '../api';

/**
 * FR-WSH-5: pick one of the user's other lists (event name + item count) and copy all its
 * items, photos included, to the end of this one.
 */
export function CopyFromSheet({
  open,
  eventId,
  ownerId,
  onClose,
}: {
  open: boolean;
  eventId: string;
  ownerId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const sources = useCopySources(eventId, open);
  const copy = useCopyFrom(eventId, ownerId);
  const [picked, setPicked] = useState<string | null>(null);

  const close = () => {
    if (copy.isPending) return;
    setPicked(null);
    onClose();
  };

  const confirm = () => {
    if (!picked) return;
    copy.mutate(picked, {
      onSuccess: (items) => {
        toast.success(t('wishlist.copy.done', { count: items.length }));
        setPicked(null);
        onClose();
      },
      onError: (error) => toast.error(errorMessage(t, error)),
    });
  };

  const list = sources.data ?? [];

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t('wishlist.copy.title')}
      description={t('wishlist.copy.body')}
      footer={
        <>
          <Button variant="ghost" disabled={copy.isPending} onClick={close}>
            {t('wishlist.form.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={picked === null}
            loading={copy.isPending}
            onClick={confirm}
          >
            {t('wishlist.copy.confirm')}
          </Button>
        </>
      }
    >
      {sources.isPending ? (
        <p role="status" className="text-body text-stone">
          {t('wishlist.copy.loading')}
        </p>
      ) : sources.isError ? (
        <div className="flex flex-wrap items-center gap-15">
          <p className="text-body text-error">{errorMessage(t, sources.error)}</p>
          <Button variant="nav" onClick={() => void sources.refetch()}>
            {t('events.dashboard.retry')}
          </Button>
        </div>
      ) : list.length === 0 ? (
        <p className="text-body text-charcoal">{t('wishlist.copy.none')}</p>
      ) : (
        <ul aria-label={t('wishlist.copy.sourcesLabel')} className="flex flex-col gap-10">
          {list.map((source) => (
            <li key={source.event_id}>
              <PillToggle
                pressed={picked === source.event_id}
                aria-label={t('wishlist.copy.sourceLabel', {
                  name: source.name,
                  count: source.item_count,
                })}
                onPressedChange={() => {
                  setPicked(source.event_id);
                }}
                className="max-w-full"
              >
                <span className="min-w-0 truncate">{source.name}</span>
                <span aria-hidden="true">·</span>
                <span className="shrink-0">
                  {t('wishlist.copy.itemCount', { count: source.item_count })}
                </span>
              </PillToggle>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
