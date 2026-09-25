import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Button, Eyebrow } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

import { useConversations, type ConversationSummary } from '../api';
import { ConversationRow } from '../components/ConversationRow';

interface EventGroup {
  event: ConversationSummary['event'];
  conversations: ConversationSummary[];
}

/** Keeps the API's order (latest activity first) for both the groups and their rows. */
function groupByEvent(conversations: ConversationSummary[]): EventGroup[] {
  const groups = new Map<string, EventGroup>();
  for (const conversation of conversations) {
    const group = groups.get(conversation.event.id) ?? {
      event: conversation.event,
      conversations: [],
    };
    group.conversations.push(conversation);
    groups.set(conversation.event.id, group);
  }
  return [...groups.values()];
}

/** `/chats` (FR-CHT-6): every conversation, grouped by event. */
export function ChatsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('chat.list.title'));
  const query = useConversations();

  return (
    <section aria-labelledby="chats-title" className="flex flex-col gap-24 md:gap-32">
      <h1 id="chats-title" className="font-serif text-heading font-medium md:text-heading-lg">
        {t('chat.list.title')}
      </h1>
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
      ) : (
        <ChatGroups
          conversations={query.data.pages.flatMap((page) => page.items)}
          hasMore={query.hasNextPage}
          loadingMore={query.isFetchingNextPage}
          onLoadMore={() => void query.fetchNextPage()}
        />
      )}
    </section>
  );
}

function ChatGroups({
  conversations,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  conversations: ConversationSummary[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const { t } = useTranslation();
  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-start gap-12">
        <p className="font-serif text-heading-sm font-medium">{t('chat.list.empty.title')}</p>
        <p className="text-body text-charcoal">{t('chat.list.empty.body')}</p>
        <Button variant="primary" asChild>
          <Link to="/">{t('chat.list.empty.cta')}</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-32">
      {groupByEvent(conversations).map(({ event, conversations: rows }) => (
        <section
          key={event.id}
          aria-labelledby={`chats-event-${event.id}`}
          className="flex flex-col gap-12"
        >
          <div className="flex flex-col gap-6">
            <Eyebrow>{t(`events.state.${event.state}`)}</Eyebrow>
            <h2
              id={`chats-event-${event.id}`}
              className="font-serif text-heading-sm font-medium break-words"
            >
              {event.name}
            </h2>
          </div>
          <ul className="flex flex-col gap-10">
            {rows.map((conversation) => (
              <li key={conversation.id}>
                <ConversationRow conversation={conversation} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {hasMore && (
        <Button variant="nav" loading={loadingMore} onClick={onLoadMore} className="self-center">
          {t('chat.list.loadMore')}
        </Button>
      )}
    </div>
  );
}
