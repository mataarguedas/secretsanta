import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { Button, Eyebrow, Modal, useToast } from '@/components/ui';
import { ApiError } from '@/lib/apiClient';
import { cn } from '@/lib/cn';
import { codeMessage, errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

import {
  useConversation,
  useDeleteMessage,
  useMarkRead,
  useMessages,
  type ConversationDetail,
  type MemberPublic,
  type MessagePublic,
} from '../api';
import { Composer } from '../components/Composer';
import { ConversationAvatar, MemberAvatar } from '../components/MemberAvatar';
import { conversationTitle, memberName } from '../members';
import { useOutbox, useSendMessage, type OutboxItem } from '../outbox';
import { useRealtime } from '../realtimeContext';

/** `/chats/:conversationId`: a full-height thread (the layout drops the tab bar here). */
export function ThreadPage() {
  const { t } = useTranslation();
  const { conversationId = '' } = useParams<{ conversationId: string }>();
  const detail = useConversation(conversationId);

  if (detail.isPending) {
    return (
      <p role="status" className="p-16 text-body text-stone">
        {t('chat.thread.loading')}
      </p>
    );
  }
  if (detail.isError) {
    const missing =
      detail.error instanceof ApiError &&
      (detail.error.status === 404 || detail.error.status === 422);
    return (
      <section className="flex flex-col items-start gap-12 p-16">
        <h1 className="font-serif text-heading-sm font-medium">
          {missing ? t('chat.thread.notFound.title') : t('chat.thread.title')}
        </h1>
        <p className={cn('text-body', missing ? 'text-charcoal' : 'text-error')}>
          {missing ? t('chat.thread.notFound.body') : errorMessage(t, detail.error)}
        </p>
        <Button variant="nav" asChild>
          <Link to="/chats">{t('chat.thread.back')}</Link>
        </Button>
      </section>
    );
  }
  return <Thread key={conversationId} conversation={detail.data} />;
}

function Thread({ conversation }: { conversation: ConversationDetail }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { client, status, setViewing, announcement } = useRealtime();
  const messages = useMessages(conversation.id);
  const markRead = useMarkRead();
  const outboxItems = useOutbox(conversation.id);
  const { send, retry } = useSendMessage(conversation.id, conversation.my_member.id);
  const remove = useDeleteMessage();
  const [deleting, setDeleting] = useState<MessagePublic | null>(null);
  const archived = conversation.event.state === 'archived';
  const title = conversationTitle(t, conversation);
  useDocumentTitle(title);

  const members = useMemo(
    () => new Map(conversation.members.map((m) => [m.id, m])),
    [conversation.members],
  );
  const ordered = useMemo(
    () =>
      (messages.data?.pages ?? [])
        .flatMap((page) => page.items)
        .slice()
        .reverse(),
    [messages.data],
  );
  const newest = ordered.at(-1);

  // ── Presence of the page: active + read ────────────────────────────────────
  const { id } = conversation;
  const readId = useRef<string | null>(null);
  useEffect(() => {
    const update = () => {
      const visible = document.visibilityState === 'visible';
      setViewing(visible ? id : null);
      client?.setActive(visible ? id : null);
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      setViewing(null);
      client?.setActive(null);
    };
  }, [client, id, setViewing]);

  const { mutate: markAsRead } = markRead;
  useEffect(() => {
    if (archived) return undefined;
    const read = () => {
      if (document.visibilityState === 'visible') markAsRead(id);
    };
    // On open, and whenever a newer message is on screen.
    const latest = newest?.id ?? 'none';
    if (readId.current !== latest) {
      readId.current = latest;
      read();
    }
    window.addEventListener('focus', read);
    return () => {
      window.removeEventListener('focus', read);
    };
  }, [archived, id, markAsRead, newest?.id]);

  return (
    <section
      aria-labelledby="thread-title"
      className="flex h-full min-h-0 flex-col md:border md:border-mist md:bg-pure-white"
    >
      <ThreadHeader
        conversation={conversation}
        title={title}
        reconnecting={status === 'reconnecting'}
      />
      {conversation.my_member.is_anonymous && conversation.my_member.anon_number !== null && (
        <p className="border-b border-mist bg-bone px-16 py-10 text-sm text-charcoal md:px-20">
          {t('chat.thread.anonymousNotice', {
            alias: t('chat.member.anonymous', { n: conversation.my_member.anon_number }),
          })}
        </p>
      )}

      <MessageList
        messages={ordered}
        outbox={outboxItems}
        members={members}
        me={conversation.my_member}
        group={conversation.kind === 'group'}
        archived={archived}
        loading={messages.isPending}
        error={messages.isError ? errorMessage(t, messages.error) : null}
        hasOlder={messages.hasNextPage}
        loadingOlder={messages.isFetchingNextPage}
        onLoadOlder={() => void messages.fetchNextPage()}
        onRetry={retry}
        onDelete={setDeleting}
      />
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {archived ? (
        <p className="border-t border-mist px-16 py-15 pb-[calc(15px+env(safe-area-inset-bottom))] text-body text-charcoal md:px-20 md:pb-15">
          {t('chat.thread.readOnly')}
        </p>
      ) : (
        <div className="md:px-20 md:pb-20">
          <Composer onSend={send} />
        </div>
      )}

      <Modal
        open={deleting !== null}
        onClose={() => {
          if (!remove.isPending) setDeleting(null);
        }}
        title={t('chat.message.deleteConfirm.title')}
        description={t('chat.message.deleteConfirm.body')}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => {
                setDeleting(null);
              }}
            >
              {t('chat.message.deleteConfirm.cancel')}
            </Button>
            <Button
              variant="secondary"
              loading={remove.isPending}
              onClick={() => {
                if (!deleting) return;
                remove.mutate(deleting, {
                  onError: (error) => toast.error(errorMessage(t, error)),
                  onSettled: () => {
                    setDeleting(null);
                  },
                });
              }}
            >
              {t('chat.message.deleteConfirm.confirm')}
            </Button>
          </>
        }
      />
    </section>
  );
}

function ThreadHeader({
  conversation,
  title,
  reconnecting,
}: {
  conversation: ConversationDetail;
  title: string;
  reconnecting: boolean;
}) {
  const { t } = useTranslation();
  const anonymousOther = conversation.title_member?.is_anonymous === true;
  return (
    <header className="flex items-center gap-12 border-b border-ink-black px-16 pt-[calc(10px+env(safe-area-inset-top))] pb-10 md:px-20 md:pt-15 md:pb-15">
      <Button variant="nav" iconOnly aria-label={t('chat.thread.back')} asChild>
        <Link to="/chats">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-20" fill="none">
            <path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </Link>
      </Button>
      <ConversationAvatar conversation={conversation} label={title} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {anonymousOther ? (
          <h1 id="thread-title">
            <Eyebrow as="span">{title}</Eyebrow>
          </h1>
        ) : (
          <h1 id="thread-title" className="truncate font-serif text-subheading font-medium">
            {title}
          </h1>
        )}
        <Link
          to={`/events/${conversation.event.id}/chat`}
          className="truncate text-sm text-stone underline-offset-4 hover:underline"
        >
          {conversation.event.name}
        </Link>
      </div>
      {reconnecting && (
        <p role="status" className="shrink-0 text-sm text-stone">
          {t('chat.thread.reconnecting')}
        </p>
      )}
    </header>
  );
}

function MessageList({
  messages,
  outbox,
  members,
  me,
  group,
  archived,
  loading,
  error,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onRetry,
  onDelete,
}: {
  messages: MessagePublic[];
  outbox: OutboxItem[];
  members: Map<string, MemberPublic>;
  me: MemberPublic;
  group: boolean;
  archived: boolean;
  loading: boolean;
  error: string | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onRetry: (clientId: string) => void;
  onDelete: (message: MessagePublic) => void;
}) {
  const { t, i18n } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const topSentinel = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const previousHeight = useRef(0);
  const firstId = messages[0]?.id;
  const lastKey = `${messages.at(-1)?.id ?? ''}:${String(outbox.length)}`;

  // Older messages are prepended: keep what the user was reading in place.
  const prependedFrom = useRef<string | undefined>(firstId);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (
      prependedFrom.current !== undefined &&
      prependedFrom.current !== firstId &&
      !stick.current
    ) {
      el.scrollTop += el.scrollHeight - previousHeight.current;
    }
    prependedFrom.current = firstId;
    previousHeight.current = el.scrollHeight;
  }, [firstId]);

  // New messages at the bottom: follow them if the user is already at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (stick.current) el.scrollTop = el.scrollHeight;
    previousHeight.current = el.scrollHeight;
  }, [lastKey]);

  // Load older on scroll-up (the pill below does the same for keyboards).
  useEffect(() => {
    const sentinel = topSentinel.current;
    if (!sentinel || !hasOlder || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !loadingOlder) onLoadOlder();
    });
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [hasOlder, loadingOlder, onLoadOlder]);

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-16 py-15 md:px-20"
    >
      <div ref={topSentinel} />
      {hasOlder && (
        <div className="mb-15 flex justify-center">
          <Button variant="nav" loading={loadingOlder} onClick={onLoadOlder}>
            {t('chat.thread.loadOlder')}
          </Button>
        </div>
      )}
      {loading && (
        <p role="status" className="text-body text-stone">
          {t('chat.thread.loading')}
        </p>
      )}
      {error && <p className="text-body text-error">{error}</p>}
      <ol aria-label={t('chat.thread.messagesLabel')} className="flex flex-col gap-12">
        {messages.map((message) => {
          const sender = members.get(message.sender_member_id);
          const mine = message.sender_member_id === me.id;
          return (
            <MessageBubble
              key={message.id}
              mine={mine}
              senderName={sender ? memberName(t, sender) : t('chat.member.former')}
              sender={group && !mine ? sender : undefined}
              time={formatDateTime(message.created_at, i18n.language, { timeStyle: 'short' })}
              dateTime={message.created_at}
              body={
                message.deleted ? (
                  <span className="text-stone">{t('chat.message.deleted')}</span>
                ) : (
                  message.body
                )
              }
              actions={
                mine &&
                !message.deleted &&
                !archived && (
                  <Button
                    variant="ghost"
                    aria-label={t('chat.message.deleteLabel')}
                    onClick={() => {
                      onDelete(message);
                    }}
                  >
                    {t('chat.message.delete')}
                  </Button>
                )
              }
            />
          );
        })}
        {outbox.map((item) => (
          <MessageBubble
            key={item.client_id}
            mine
            senderName={t('chat.member.you')}
            time={
              item.status === 'pending'
                ? t('chat.message.pending')
                : t('chat.message.failed', {
                    reason: codeMessage(t, item.error ?? 'UNKNOWN_ERROR'),
                  })
            }
            failed={item.status === 'failed'}
            status={item.status}
            body={item.body}
            actions={
              item.status === 'failed' && (
                <Button
                  variant="nav"
                  onClick={() => {
                    onRetry(item.client_id);
                  }}
                >
                  {t('chat.message.retry')}
                </Button>
              )
            }
          />
        ))}
      </ol>
    </div>
  );
}

function MessageBubble({
  mine,
  senderName,
  sender,
  time,
  dateTime,
  failed = false,
  status,
  body,
  actions,
}: {
  mine: boolean;
  senderName: string;
  sender?: MemberPublic | undefined;
  time: string;
  dateTime?: string;
  failed?: boolean;
  status?: OutboxItem['status'];
  body: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <li
      data-status={status}
      className={cn('flex max-w-[85%] items-end gap-8 md:max-w-[70%]', mine && 'self-end')}
    >
      {sender && <MemberAvatar member={sender} size="sm" label={senderName} />}
      <div
        className={cn(
          'flex min-w-0 flex-col gap-6 border px-15 py-10',
          mine ? 'border-ink-black bg-pure-white' : 'border-mist bg-pure-white',
          failed && 'border-error',
        )}
      >
        {sender && (
          <span className="text-sm text-charcoal">
            {sender.is_anonymous ? <Eyebrow as="span">{senderName}</Eyebrow> : senderName}
          </span>
        )}
        <span className="sr-only">{senderName}: </span>
        <p className="text-body break-words whitespace-pre-wrap">{body}</p>
        <div className="flex flex-wrap items-center justify-end gap-8">
          {dateTime ? (
            <time dateTime={dateTime} className="mr-auto text-caption text-stone">
              {time}
            </time>
          ) : (
            <span className={cn('mr-auto text-caption', failed ? 'text-error' : 'text-stone')}>
              {time}
            </span>
          )}
          {actions}
        </div>
      </div>
    </li>
  );
}
