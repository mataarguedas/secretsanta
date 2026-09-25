import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Card, Modal, useToast } from '@/components/ui';
import { RevealSection } from '@/features/draw/components/RevealSection';
import { ExclusionsCard } from '@/features/exclusions/components/ExclusionsCard';
import { InviteLinkCard } from '@/features/invites/components/InviteLinkCard';
import { errorMessage } from '@/lib/errors';

import { useArchiveEvent, useDeleteEvent, useUpdateEvent, type EventDetail } from '../api';
import { eventToFormValues, lockedFields, toUpdatePayload } from '../schemas';
import { CoverSection } from './CoverSection';
import { EventForm } from './EventForm';

/**
 * Host-only Manage tab: the invite link, exclusions, the reveal ("the draw is done" once
 * drawn), archive (DRAWN, after the exchange), the cover photo (OPEN only), edit (fields
 * locked by state) and delete (OPEN only). Reveal sits above the edit form so its coral
 * button and the form's coral submit never share a viewport.
 *
 * Archived (CLAUDE.md §2.6): a note, then the same cards read-only; no edit controls.
 */
export function ManageTab({ event }: { event: EventDetail }) {
  const archived = event.state === 'archived';

  return (
    <div className="flex flex-col gap-32 md:gap-[64px]">
      {archived && <ArchivedNote />}
      <InviteLinkCard event={event} />
      <ExclusionsCard event={event} />
      <RevealSection event={event} />
      {event.state === 'drawn' && isPast(event.exchange_at) && (
        <ArchiveEventSection event={event} />
      )}
      {event.state === 'open' && <CoverSection event={event} />}
      {!archived && <EditEventSection event={event} />}
      {event.state === 'open' && <DeleteEventSection event={event} />}
    </div>
  );
}

const isPast = (iso: string) => new Date(iso).getTime() <= Date.now();

function ArchivedNote() {
  const { t } = useTranslation();
  return (
    <Card as="section" aria-labelledby="manage-archived" className="flex flex-col gap-12">
      <h2 id="manage-archived" className="font-serif text-heading-sm font-medium">
        {t('events.manage.archived.title')}
      </h2>
      <p className="text-body text-charcoal">{t('events.manage.archived.body')}</p>
    </Card>
  );
}

/** PRD §3: the host may archive once the exchange has passed (else a daily job does it
 * 7 days later). Secondary pill + confirm Modal; the event then moves to Past. */
function ArchiveEventSection({ event }: { event: EventDetail }) {
  const { t } = useTranslation();
  const toast = useToast();
  const archive = useArchiveEvent(event.id);
  const [open, setOpen] = useState(false);

  return (
    <Card as="section" aria-labelledby="manage-archive" className="flex flex-col gap-12">
      <h2 id="manage-archive" className="font-serif text-heading-sm font-medium">
        {t('events.manage.archive.title')}
      </h2>
      <p className="text-body text-charcoal">{t('events.manage.archive.body')}</p>
      <div>
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(true);
          }}
        >
          {t('events.manage.archive.open')}
        </Button>
      </div>

      <Modal
        open={open}
        onClose={() => {
          if (!archive.isPending) setOpen(false);
        }}
        title={t('events.manage.archive.confirmTitle', { name: event.name })}
        description={t('events.manage.archive.warning')}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={archive.isPending}
              onClick={() => {
                setOpen(false);
              }}
            >
              {t('events.manage.delete.cancel')}
            </Button>
            <Button
              variant="secondary"
              loading={archive.isPending}
              onClick={() => {
                archive.mutate(undefined, {
                  onSuccess: () => {
                    setOpen(false);
                    toast.success(t('events.manage.archive.done'));
                  },
                  onError: (error) => {
                    setOpen(false);
                    toast.error(errorMessage(t, error));
                  },
                });
              }}
            >
              {t('events.manage.archive.confirm')}
            </Button>
          </>
        }
      />
    </Card>
  );
}

function EditEventSection({ event }: { event: EventDetail }) {
  const { t } = useTranslation();
  const toast = useToast();
  const update = useUpdateEvent(event.id);
  const initial = eventToFormValues(event);

  return (
    <section aria-labelledby="manage-edit" className="flex flex-col gap-15">
      <h2 id="manage-edit" className="font-serif text-heading-sm font-medium">
        {t('events.manage.edit.title')}
      </h2>
      {event.state === 'drawn' && (
        <p className="text-body text-charcoal">{t('events.manage.edit.drawnNote')}</p>
      )}
      <EventForm
        // Remount on state change so the locked set and defaults start fresh.
        key={event.state}
        submitLabel={t('events.manage.edit.submit')}
        defaultValues={initial}
        disabledFields={lockedFields(event.state)}
        schemaOptions={{ originalExchangeAt: initial.exchangeAt }}
        onSubmit={async (values) => {
          await update.mutateAsync(toUpdatePayload(values, event));
          toast.success(t('events.manage.edit.saved'));
        }}
      />
    </section>
  );
}

function DeleteEventSection({ event }: { event: EventDetail }) {
  const { t } = useTranslation();
  const toast = useToast();
  const remove = useDeleteEvent(event.id);
  const [open, setOpen] = useState(false);

  return (
    <Card as="section" aria-labelledby="manage-delete" className="flex flex-col gap-12">
      <h2 id="manage-delete" className="font-serif text-heading-sm font-medium">
        {t('events.manage.delete.title')}
      </h2>
      <p className="text-body text-charcoal">{t('events.manage.delete.body')}</p>
      <div>
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(true);
          }}
        >
          {t('events.manage.delete.open')}
        </Button>
      </div>

      <Modal
        open={open}
        onClose={() => {
          if (!remove.isPending) setOpen(false);
        }}
        title={t('events.manage.delete.confirmTitle', { name: event.name })}
        description={t('events.manage.delete.warning')}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => {
                setOpen(false);
              }}
            >
              {t('events.manage.delete.cancel')}
            </Button>
            <Button
              variant="secondary"
              loading={remove.isPending}
              onClick={() => {
                remove.mutate(undefined, {
                  onSuccess: () => toast.success(t('events.manage.delete.done')),
                  onError: (error) => {
                    setOpen(false);
                    toast.error(errorMessage(t, error));
                  },
                });
              }}
            >
              {t('events.manage.delete.confirm')}
            </Button>
          </>
        }
      />
    </Card>
  );
}
