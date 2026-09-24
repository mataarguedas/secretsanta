import { useTranslation } from 'react-i18next';

import { Eyebrow } from '@/components/ui';
import { formatCRC, formatDateTime } from '@/lib/format';

import type { EventDetail } from '../api';

/** Event page header (PRD §9.3.4): state (+ HOSTING), serif name, budget · date · place. */
export function EventHeader({ event }: { event: EventDetail }) {
  const { t, i18n } = useTranslation();

  return (
    <header className="flex flex-col gap-12">
      {event.cover_url && (
        <img
          src={event.cover_url}
          alt={t('events.cover.alt', { name: event.name })}
          className="aspect-[3/2] w-full rounded-none border border-mist object-cover md:aspect-[3/1]"
        />
      )}
      <div className="flex flex-wrap gap-x-15 gap-y-6">
        <Eyebrow as="span">{t(`events.state.${event.state}`)}</Eyebrow>
        {event.my_role === 'host' && (
          <Eyebrow as="span">{t('events.dashboard.hosting.eyebrow')}</Eyebrow>
        )}
      </div>
      <h1 className="font-serif text-heading font-medium break-words md:text-heading-lg">
        {event.name}
      </h1>
      <ul className="flex flex-wrap gap-x-20 gap-y-6 text-body text-charcoal">
        <li>
          <span className="sr-only">{t('events.card.budget')}: </span>
          <span className="font-mono text-ink-black">{formatCRC(event.budget_crc)}</span>
        </li>
        <li>
          <span className="sr-only">{t('events.card.date')}: </span>
          <time dateTime={event.exchange_at}>
            {formatDateTime(event.exchange_at, i18n.language)}
          </time>
        </li>
        {(event.is_online || event.location) && (
          <li className="break-words">
            <span className="sr-only">{t('events.detail.location')}: </span>
            {event.is_online ? t('events.detail.online') : event.location}
          </li>
        )}
      </ul>
    </header>
  );
}
