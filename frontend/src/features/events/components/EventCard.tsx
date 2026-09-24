import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Card, Eyebrow } from '@/components/ui';
import { formatCRC, formatDate } from '@/lib/format';

import type { EventSummary } from '../api';

/**
 * Dashboard card (FR-EVT-3): the whole card is one link to the event. State eyebrow, serif
 * name, then participants, date and budget (labels are for screen readers; the values are
 * self-explanatory on screen).
 */
export function EventCard({ event }: { event: EventSummary }) {
  const { t, i18n } = useTranslation();

  return (
    <Card asChild>
      <Link to={`/events/${event.id}`} className="flex h-full flex-col gap-12">
        {event.cover_thumb_url && (
          <img
            src={event.cover_thumb_url}
            alt={t('events.cover.alt', { name: event.name })}
            loading="lazy"
            decoding="async"
            className="-mx-20 -mt-20 aspect-[2/1] w-[calc(100%+40px)] max-w-none rounded-none border-b border-mist object-cover"
          />
        )}
        <Eyebrow as="span">{t(`events.state.${event.state}`)}</Eyebrow>
        <h3 className="font-serif text-heading-sm font-medium break-words">{event.name}</h3>
        {/* Each dt/dd pair is wrapped in one div, the only nesting a <dl> allows. */}
        <dl className="mt-auto grid grid-cols-[1fr_auto] items-baseline gap-x-15 gap-y-6 text-body text-charcoal">
          <div className="col-span-2">
            <dt className="sr-only">{t('events.card.participantsLabel')}</dt>
            <dd>{t('events.card.participants', { count: event.participant_count })}</dd>
          </div>
          <div>
            <dt className="sr-only">{t('events.card.date')}</dt>
            <dd>
              <time dateTime={event.exchange_at}>
                {formatDate(event.exchange_at, i18n.language)}
              </time>
            </dd>
          </div>
          <div className="text-right">
            <dt className="sr-only">{t('events.card.budget')}</dt>
            <dd className="font-mono text-ink-black">{formatCRC(event.budget_crc)}</dd>
          </div>
        </dl>
      </Link>
    </Card>
  );
}
