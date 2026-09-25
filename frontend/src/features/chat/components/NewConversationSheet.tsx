import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { Avatar, Button, PillToggle, Sheet, useToast } from '@/components/ui';
import { useParticipants } from '@/features/events/api';
import { errorMessage } from '@/lib/errors';

import { useStartConversation } from '../api';

type Mode = 'direct' | 'anonymous';

/**
 * Pick someone in the event (never yourself) and Named or Anonymous, then Start. Starting
 * is idempotent: an existing thread with that person, in that mode, just opens.
 */
export function NewConversationSheet({
  eventId,
  open,
  onClose,
}: {
  eventId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const roster = useParticipants(eventId);
  const start = useStartConversation(eventId);
  const [recipient, setRecipient] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('direct');
  const others = (roster.data ?? []).filter((p) => !p.is_self);

  const close = () => {
    if (start.isPending) return;
    setRecipient(null);
    setMode('direct');
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t('chat.new.title')}
      footer={
        <>
          <Button variant="ghost" disabled={start.isPending} onClick={close}>
            {t('chat.new.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={recipient === null}
            loading={start.isPending}
            onClick={() => {
              if (!recipient) return;
              start.mutate(
                { kind: mode, recipient_id: recipient },
                {
                  onSuccess: (conversation) => {
                    onClose();
                    void navigate(`/chats/${conversation.id}`);
                  },
                  onError: (error) => toast.error(errorMessage(t, error)),
                },
              );
            }}
          >
            {t('chat.new.start')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-24">
        <div role="group" aria-labelledby="new-who" className="flex flex-col gap-10">
          <p id="new-who" className="text-body">
            {t('chat.new.who')}
          </p>
          {roster.isPending ? (
            <p role="status" className="text-body text-stone">
              {t('chat.new.loading')}
            </p>
          ) : others.length === 0 ? (
            <p className="text-body text-charcoal">{t('chat.new.noOne')}</p>
          ) : (
            <div className="flex flex-wrap gap-10">
              {others.map((person) => (
                <PillToggle
                  key={person.user_id}
                  pressed={recipient === person.user_id}
                  onPressedChange={() => {
                    setRecipient(person.user_id);
                  }}
                  className="pl-6"
                >
                  <span aria-hidden="true" className="inline-flex">
                    <Avatar size="sm" src={person.avatar_url} alt={person.name} />
                  </span>
                  {person.name}
                </PillToggle>
              ))}
            </div>
          )}
        </div>

        <div role="group" aria-labelledby="new-mode" className="flex flex-col gap-10">
          <p id="new-mode" className="text-body">
            {t('chat.new.mode')}
          </p>
          <div className="flex gap-10">
            {(['direct', 'anonymous'] as const).map((value) => (
              <PillToggle
                key={value}
                pressed={mode === value}
                onPressedChange={() => {
                  setMode(value);
                }}
              >
                {t(value === 'direct' ? 'chat.new.named' : 'chat.new.anonymous')}
              </PillToggle>
            ))}
          </div>
          <p className="text-sm text-charcoal">
            {t(mode === 'direct' ? 'chat.new.namedHelp' : 'chat.new.anonymousHelp')}
          </p>
        </div>
      </div>
    </Sheet>
  );
}
