import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar, Button, Card, Modal, useToast } from '@/components/ui';
import { useParticipants, type EventDetail } from '@/features/events/api';
import { errorMessage } from '@/lib/errors';

import { useDrawEvent } from '../api';

const MIN_PARTICIPANTS = 3;

/**
 * Manage › Reveal (FR-DRW-1/2): the screen's coral primary action, disabled with the
 * reason from `draw_readiness`, and a confirm Modal that lists everyone. OPEN only.
 */
export function RevealSection({ event }: { event: EventDetail }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const reasonId = useId();
  const readiness = event.draw_readiness;
  const count = readiness?.participant_count ?? event.participant_count;

  let reason: string | null = null;
  if (count < MIN_PARTICIPANTS) reason = t('draw.reveal.needPeople');
  else if (readiness && !readiness.feasible) reason = t('draw.reveal.impossible');
  const canDraw = reason === null && (readiness?.can_draw ?? false);

  return (
    <Card as="section" aria-labelledby="manage-reveal" className="flex flex-col gap-12">
      <h2 id="manage-reveal" className="font-serif text-heading-sm font-medium">
        {t('draw.reveal.title')}
      </h2>
      <p className="text-body text-charcoal">{t('draw.reveal.body')}</p>
      {reason && (
        <p id={reasonId} className="text-body text-error">
          {reason}
        </p>
      )}
      <div>
        <Button
          variant="primary"
          disabled={!canDraw}
          aria-describedby={reason ? reasonId : undefined}
          onClick={() => {
            setOpen(true);
          }}
        >
          {t('draw.reveal.button')}
        </Button>
      </div>
      <ConfirmRevealModal
        event={event}
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      />
    </Card>
  );
}

function ConfirmRevealModal({
  event,
  open,
  onClose,
}: {
  event: EventDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const roster = useParticipants(event.id);
  const drawEvent = useDrawEvent(event.id);
  // A second click can land before `isPending` re-renders the button as disabled.
  const submitted = useRef(false);

  const confirm = () => {
    if (submitted.current) return;
    submitted.current = true;
    drawEvent.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('draw.done'));
        onClose();
      },
      onError: (error) => {
        submitted.current = false;
        toast.error(errorMessage(t, error));
        onClose();
      },
    });
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!drawEvent.isPending) onClose();
      }}
      title={t('draw.confirm.title')}
      description={t('draw.confirm.reminder')}
      footer={
        <>
          <Button variant="ghost" disabled={drawEvent.isPending} onClick={onClose}>
            {t('draw.confirm.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={drawEvent.isPending}
            disabled={roster.isPending}
            onClick={confirm}
          >
            {t('draw.confirm.submit')}
          </Button>
        </>
      }
    >
      <h3 className="text-sm text-stone">{t('draw.confirm.participants')}</h3>
      {roster.isPending ? (
        <p role="status" className="text-body text-stone">
          {t('events.participants.loading')}
        </p>
      ) : roster.isError ? (
        <p className="text-body text-error">{errorMessage(t, roster.error)}</p>
      ) : (
        <ul aria-label={t('draw.confirm.participants')} className="flex flex-col gap-10">
          {roster.data.map((person) => (
            <li key={person.user_id} className="flex items-center gap-12">
              <span aria-hidden="true" className="inline-flex">
                <Avatar size="sm" src={person.avatar_url} alt={person.name} />
              </span>
              <span className="text-body break-words">
                {person.name}
                {person.is_self && (
                  <span className="text-stone"> {t('events.participants.you')}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
