import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Card, Eyebrow, Pill } from '@/components/ui';
import { formatRelative } from '@/lib/format';

import type { ConversationSummary } from '../api';
import { conversationTitle } from '../members';
import { ConversationAvatar } from './MemberAvatar';

/**
 * One conversation: avatar (✦ for Secret Elf #N), name, a one-line preview and the time,
 * with an unread count. The whole card is one link (CLAUDE.md §6.2 interactive card).
 */
export function ConversationRow({ conversation }: { conversation: ConversationSummary }) {
  const { t, i18n } = useTranslation();
  const title = conversationTitle(t, conversation);
  const last = conversation.last_message;
  const mine = last?.sender_member_id === conversation.my_member.id;
  const theyAreAnonymous = conversation.title_member?.is_anonymous === true;
  const iAmAnonymous = conversation.my_member.is_anonymous;

  let preview = t('chat.list.noMessages');
  if (last) {
    const text = last.deleted ? t('chat.message.deleted') : (last.body ?? '');
    preview = mine ? t('chat.list.mine', { text }) : text;
  }
  const time = last ? (formatRelative(last.created_at, i18n.language) ?? t('chat.time.now')) : null;
  const unread = conversation.unread_count;

  return (
    <Card asChild>
      <Link
        to={`/chats/${conversation.id}`}
        className="flex items-center gap-15"
        aria-label={
          unread > 0 ? `${title}, ${t('chat.list.unread', { count: unread })}` : undefined
        }
      >
        <ConversationAvatar conversation={conversation} label={title} />
        <span className="flex min-w-0 flex-1 flex-col gap-6">
          <span className="flex flex-wrap items-baseline gap-x-10 gap-y-2">
            {theyAreAnonymous ? (
              <Eyebrow as="span">{title}</Eyebrow>
            ) : (
              <span className="truncate text-body text-ink-black">{title}</span>
            )}
            {iAmAnonymous && (
              <span className="text-sm text-stone">
                {t('chat.list.asAlias', {
                  alias: t('chat.member.anonymous', { n: conversation.my_member.anon_number }),
                })}
              </span>
            )}
          </span>
          <span className="truncate text-sm text-charcoal">{preview}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-6">
          {time && last && (
            <time dateTime={last.created_at} className="text-sm text-stone">
              {time}
            </time>
          )}
          {unread > 0 && (
            <Pill className="bg-ink-black text-pure-white" aria-hidden="true">
              {unread > 99 ? '99+' : unread}
            </Pill>
          )}
        </span>
      </Link>
    </Card>
  );
}
