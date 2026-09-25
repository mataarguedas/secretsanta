import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Button, Eyebrow } from '@/components/ui';
import { InstallBanner } from '@/features/notifications/components/InstallBanner';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

import { useEvents, type EventSection } from '../api';
import { EventCard } from '../components/EventCard';

type SectionQuery = ReturnType<typeof useEvents>;

const SECTIONS: readonly EventSection[] = ['hosting', 'participating', 'past'];

/**
 * Signed-in `/` (FR-EVT-3, PRD §9.3.2): Hosting, Participating and Past card grids and one
 * coral "Create event" in the header. With no events at all, a typographic empty state
 * (whose CTA is then the page's only coral button).
 */
export function DashboardPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('events.dashboard.title'));

  const hosting = useEvents('hosting');
  const participating = useEvents('participating');
  const past = useEvents('past');
  const queries: Record<EventSection, SectionQuery> = { hosting, participating, past };
  const all = Object.values(queries);

  if (all.some((q) => q.isPending)) {
    return (
      <p role="status" className="text-body text-stone">
        {t('events.dashboard.loading')}
      </p>
    );
  }

  const count = (q: SectionQuery) => q.data?.pages[0]?.items.length ?? 0;
  if (all.every((q) => q.isSuccess && count(q) === 0)) return <EmptyDashboard />;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-15">
        <h1 className="font-serif text-heading font-medium md:text-heading-lg">
          {t('events.dashboard.title')}
        </h1>
        <Button variant="primary" asChild>
          <Link to="/events/new">{t('events.dashboard.create')}</Link>
        </Button>
      </header>

      <InstallBanner />

      {SECTIONS.map((section) => {
        const query = queries[section];
        // Hosting is always shown; the others only when they have something.
        if (section !== 'hosting' && query.isSuccess && count(query) === 0) return null;
        return <DashboardSection key={section} section={section} query={query} />;
      })}
    </>
  );
}

function DashboardSection({ section, query }: { section: EventSection; query: SectionQuery }) {
  const { t } = useTranslation();
  const headingId = `dashboard-${section}`;
  const events = query.data?.pages.flatMap((page) => page.items) ?? [];

  let body: ReactNode;
  if (query.isError) {
    body = (
      <div className="flex flex-wrap items-center gap-15">
        <p className="text-body text-error">{t('events.dashboard.error')}</p>
        <Button variant="nav" onClick={() => void query.refetch()}>
          {t('events.dashboard.retry')}
        </Button>
      </div>
    );
  } else if (events.length === 0) {
    body = <p className="text-body text-charcoal">{t('events.dashboard.hostingEmpty')}</p>;
  } else {
    body = (
      <ul className="grid grid-cols-1 gap-20 md:grid-cols-2 lg:grid-cols-3">
        {events.map((event) => (
          <li key={event.id}>
            <EventCard event={event} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-15">
      <div className="flex flex-col gap-6">
        {section === 'hosting' && <Eyebrow>{t('events.dashboard.hosting.eyebrow')}</Eyebrow>}
        <h2 id={headingId} className="font-serif text-heading-sm font-medium md:text-heading">
          {t(`events.dashboard.${section}.title`)}
        </h2>
      </div>
      {body}
      {query.hasNextPage && (
        <div>
          <Button
            variant="nav"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t('events.dashboard.loadMore')}
          </Button>
        </div>
      )}
    </section>
  );
}

/** No events anywhere: serif headline, one line, one CTA (CLAUDE.md §6.2). */
function EmptyDashboard() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-15 py-32 text-center">
      <h1 className="max-w-[20ch] font-serif text-heading font-medium md:text-heading-lg">
        {t('events.dashboard.empty.title')}
      </h1>
      <p className="max-w-[36rem] text-body text-charcoal">{t('events.dashboard.empty.body')}</p>
      <Button variant="primary" asChild>
        <Link to="/events/new">{t('events.dashboard.create')}</Link>
      </Button>
    </section>
  );
}
