import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui';
import type { EventDetail } from '@/features/events/api';
import { errorMessage } from '@/lib/errors';

import { useConversations } from '../api';
import { ConversationRow } from './ConversationRow';
import { NewConversationSheet } from './NewConversationSheet';

/** Event › Chat: this event's conversations, the group first, and "New conversation". */
export function EventChatTab({ event }: { event: EventDetail }) {
  const { t } = useTranslation();
  const query = useConversations(event.id);
  const [open, setOpen] = useState(false);
  const archived = event.state === 'archived';

  const conversations = (query.data?.pages ?? []).flatMap((page) => page.items);
  const ordered = [
    ...conversations.filter((c) => c.kind === 'group'),
    ...conversations.filter((c) => c.kind !== 'group'),
  ];

  return (
    <section aria-labelledby="event-chats" className="flex flex-col gap-20">
      <div className="flex flex-wrap items-center justify-between gap-15">
        <h2 id="event-chats" className="font-serif text-heading-sm font-medium">
          {t('chat.eventTab.title')}
        </h2>
        {!archived && (
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(true);
            }}
          >
            {t('chat.eventTab.new')}
          </Button>
        )}
      </div>
      {archived && <p className="text-body text-charcoal">{t('chat.thread.readOnly')}</p>}

      {query.isPending ? (
        <p role="status" className="text-body text-stone">
          {t('chat.list.loading')}
        </p>
      ) : query.isError ? (
        <div className="flex flex-wrap items-center gap-15">
          <p className="text-body text-error">{errorMessage(t, query.error)}</p>
          <Button variant="nav" onClick={() => void query.refetch()}>
            {t('events.dashboard.retry')}
          </Button>
        </div>
      ) : ordered.length === 0 ? (
        <div className="flex flex-col items-start gap-12">
          <p className="font-serif text-heading-sm font-medium">{t('chat.eventTab.empty.title')}</p>
          <p className="text-body text-charcoal">{t('chat.eventTab.empty.body')}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-10">
          {ordered.map((conversation) => (
            <li key={conversation.id}>
              <ConversationRow conversation={conversation} />
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <Button
          variant="nav"
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
          className="self-center"
        >
          {t('chat.list.loadMore')}
        </Button>
      )}

      {!archived && (
        <NewConversationSheet
          eventId={event.id}
          open={open}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </section>
  );
}
