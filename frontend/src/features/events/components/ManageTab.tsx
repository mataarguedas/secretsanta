import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Card, Modal, useToast } from '@/components/ui';
import { ExclusionsCard } from '@/features/exclusions/components/ExclusionsCard';
import { InviteLinkCard } from '@/features/invites/components/InviteLinkCard';
import { errorMessage } from '@/lib/errors';

import { useDeleteEvent, useUpdateEvent, type EventDetail } from '../api';
import { eventToFormValues, lockedFields, toUpdatePayload } from '../schemas';
import { EventForm } from './EventForm';

/**
 * Host-only Manage tab: the invite link, exclusions, edit (fields locked by state) and
 * delete (OPEN only). The reveal joins it in Prompt 16.
 */
export function ManageTab({ event }: { event: EventDetail }) {
  const { t } = useTranslation();

  // TODO(prompt 27): the read-only archived experience.
  if (event.state === 'archived') {
    return <p className="text-body text-charcoal">{t('errors.EVENT_ARCHIVED')}</p>;
  }

  return (
    <div className="flex flex-col gap-32 md:gap-[64px]">
      <InviteLinkCard event={event} />
      <ExclusionsCard event={event} />
      <EditEventSection event={event} />
      {event.state === 'open' && <DeleteEventSection event={event} />}
    </div>
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
