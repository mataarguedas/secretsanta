import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar, Card } from '@/components/ui';
import { formatCRC, formatDateTime } from '@/lib/format';

import type { EventDetail } from '../api';

/** Overview tab: description (line breaks kept), the details list and the host. */
export function EventOverview({ event }: { event: EventDetail }) {
  const { t, i18n } = useTranslation();
  const when = (iso: string) => <time dateTime={iso}>{formatDateTime(iso, i18n.language)}</time>;

  const details: [string, ReactNode][] = [
    [t('events.card.budget'), <span className="font-mono">{formatCRC(event.budget_crc)}</span>],
    [t('events.card.date'), when(event.exchange_at)],
    ...(event.join_deadline
      ? ([[t('events.detail.joinDeadline'), when(event.join_deadline)]] as [string, ReactNode][])
      : []),
    [
      t('events.detail.location'),
      event.is_online
        ? t('events.detail.online')
        : (event.location ?? t('events.detail.noLocation')),
    ],
    [
      t('events.card.participantsLabel'),
      t('events.card.participants', { count: event.participant_count }),
    ],
    [
      t('events.form.groupChat'),
      event.group_chat_enabled ? t('events.detail.groupChatOn') : t('events.detail.groupChatOff'),
    ],
  ];

  return (
    <div className="grid gap-20 lg:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-20">
        {event.description && (
          <p className="text-body break-words whitespace-pre-line text-ink-black">
            {event.description}
          </p>
        )}
        <Card>
          <h2 className="sr-only">{t('events.detail.details')}</h2>
          <dl className="grid grid-cols-1 gap-x-20 gap-y-12 sm:grid-cols-[auto_1fr]">
            {details.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-sm text-stone">{label}</dt>
                <dd className="text-body break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Card as="section" aria-labelledby="event-host" className="flex flex-col gap-12 self-start">
        <h2 id="event-host" className="text-sm text-stone">
          {t('events.detail.host')}
        </h2>
        <div className="flex items-center gap-12">
          <Avatar size="md" src={event.host.avatar_url} alt={event.host.name} />
          <p className="font-serif text-subheading font-medium break-words">{event.host.name}</p>
        </div>
      </Card>
    </div>
  );
}
