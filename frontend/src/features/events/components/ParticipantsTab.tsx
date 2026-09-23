import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar, Button, Card, Eyebrow, Modal, useToast } from '@/components/ui';
import { errorMessage } from '@/lib/errors';

import { useParticipants, useRemoveParticipant, type EventDetail, type Participant } from '../api';

/**
 * Participants tab: the roster (host first). The host may remove others while the event
 * is OPEN; after the draw the roster is frozen (CLAUDE.md §2.3).
 */
export function ParticipantsTab({ event }: { event: EventDetail }) {
  const { t } = useTranslation();
  const toast = useToast();
  const roster = useParticipants(event.id);
  const remove = useRemoveParticipant(event.id);
  const [target, setTarget] = useState<Participant | null>(null);
  const canRemove = event.my_role === 'host' && event.state === 'open';

  if (roster.isPending) {
    return (
      <p role="status" className="text-body text-stone">
        {t('events.participants.loading')}
      </p>
    );
  }
  if (roster.isError) {
    return (
      <div className="flex flex-wrap items-center gap-15">
        <p className="text-body text-error">{errorMessage(t, roster.error)}</p>
        <Button variant="nav" onClick={() => void roster.refetch()}>
          {t('events.dashboard.retry')}
        </Button>
      </div>
    );
  }

  return (
    <Card className="p-0">
      <ul aria-label={t('events.participants.list')} className="divide-y divide-mist">
        {roster.data.map((person) => (
          <li key={person.user_id} className="flex items-center gap-12 px-20 py-12">
            <Avatar size="md" src={person.avatar_url} alt={person.name} />
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              {person.is_host && <Eyebrow as="span">{t('events.participants.host')}</Eyebrow>}
              <p className="text-body break-words">
                {person.name}
                {person.is_self && (
                  <span className="text-stone"> {t('events.participants.you')}</span>
                )}
              </p>
            </div>
            {canRemove && !person.is_host && (
              <Button
                variant="ghost"
                aria-label={t('events.participants.removeLabel', { name: person.name })}
                onClick={() => {
                  setTarget(person);
                }}
              >
                {t('events.participants.remove')}
              </Button>
            )}
          </li>
        ))}
      </ul>

      <Modal
        open={target !== null}
        onClose={() => {
          if (!remove.isPending) setTarget(null);
        }}
        title={t('events.participants.removeTitle', { name: target?.name ?? '' })}
        description={t('events.participants.removeBody')}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => {
                setTarget(null);
              }}
            >
              {t('events.manage.delete.cancel')}
            </Button>
            <Button
              variant="secondary"
              loading={remove.isPending}
              onClick={() => {
                if (!target) return;
                remove.mutate(target.user_id, {
                  onSuccess: () => {
                    toast.success(t('events.participants.removed', { name: target.name }));
                    setTarget(null);
                  },
                  onError: (error) => {
                    toast.error(errorMessage(t, error));
                    setTarget(null);
                  },
                });
              }}
            >
              {t('events.participants.removeConfirm')}
            </Button>
          </>
        }
      />
    </Card>
  );
}
