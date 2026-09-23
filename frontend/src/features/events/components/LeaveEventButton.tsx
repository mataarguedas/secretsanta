import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Modal, useToast } from '@/components/ui';
import { errorMessage } from '@/lib/errors';

import { useLeaveEvent, type EventDetail } from '../api';

/** Overview: "Leave event" for a non-host while OPEN, behind a confirm (PRD §3). */
export function LeaveEventButton({ event }: { event: EventDetail }) {
  const { t } = useTranslation();
  const toast = useToast();
  const leave = useLeaveEvent(event.id);
  const [open, setOpen] = useState(false);

  if (event.my_role === 'host' || event.state !== 'open') return null;

  return (
    <div>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('events.leave.open')}
      </Button>
      <Modal
        open={open}
        onClose={() => {
          if (!leave.isPending) setOpen(false);
        }}
        title={t('events.leave.title', { name: event.name })}
        description={t('events.leave.body')}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={leave.isPending}
              onClick={() => {
                setOpen(false);
              }}
            >
              {t('events.manage.delete.cancel')}
            </Button>
            <Button
              variant="secondary"
              loading={leave.isPending}
              onClick={() => {
                leave.mutate(undefined, {
                  onSuccess: () => toast.success(t('events.leave.done', { name: event.name })),
                  onError: (error) => {
                    setOpen(false);
                    toast.error(errorMessage(t, error));
                  },
                });
              }}
            >
              {t('events.leave.confirm')}
            </Button>
          </>
        }
      />
    </div>
  );
}
