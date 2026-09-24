import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';

import { Button, Tab, TabList, TabPanel, Tabs } from '@/components/ui';
import { ApiError } from '@/lib/apiClient';
import { errorMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

import { useEvent, type EventDetail } from '../api';
import { EventHeader } from '../components/EventHeader';
import { EventNotFound } from '../components/EventNotFound';
import { EventOverview } from '../components/EventOverview';
import { ManageTab } from '../components/ManageTab';
import { ParticipantsTab } from '../components/ParticipantsTab';
import { WishlistsTab } from '@/features/wishlist/components/WishlistsTab';

import { EVENT_TABS, eventTabPath, isEventTab, type EventTab } from '../tabs';

/**
 * `/events/:id/:tab?` (FR-EVT-4, PRD §9.3.4). The URL owns the tab, so reload, Back and
 * Forward all work. Unknown tabs, and Manage for non-hosts, fall back to Overview.
 */
export function EventPage() {
  const { t } = useTranslation();
  const { id = '', tab: tabParam } = useParams<{ id: string; tab?: string }>();
  const query = useEvent(id);

  if (query.isPending) {
    return (
      <p role="status" className="text-body text-stone">
        {t('events.detail.loading')}
      </p>
    );
  }
  if (query.isError) {
    const { error } = query;
    // 404 for strangers and missing events alike; 422 is a malformed id in the URL.
    if (error instanceof ApiError && (error.status === 404 || error.status === 422)) {
      return <EventNotFound />;
    }
    return (
      <section className="flex flex-col items-start gap-15">
        <p className="text-body text-error">{errorMessage(t, error)}</p>
        <Button variant="nav" onClick={() => void query.refetch()}>
          {t('events.dashboard.retry')}
        </Button>
      </section>
    );
  }

  const event = query.data;
  const tab = tabParam ?? 'overview';
  const allowed = isEventTab(tab) && (tab !== 'manage' || event.my_role === 'host');
  if (!allowed || tabParam === 'overview') {
    return <Navigate to={eventTabPath(event.id, 'overview')} replace />;
  }
  return <EventView event={event} tab={tab} />;
}

function EventView({ event, tab }: { event: EventDetail; tab: EventTab }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useDocumentTitle(event.name);
  const tabs = EVENT_TABS.filter((value) => value !== 'manage' || event.my_role === 'host');

  return (
    <>
      <EventHeader event={event} />
      <Tabs
        value={tab}
        onValueChange={(next) => {
          if (isEventTab(next)) void navigate(eventTabPath(event.id, next));
        }}
      >
        <TabList aria-label={t('events.detail.tabs.label')}>
          {tabs.map((value) => (
            <Tab key={value} value={value}>
              {t(`events.detail.tabs.${value}`)}
            </Tab>
          ))}
        </TabList>
        <TabPanel value="overview">
          <EventOverview event={event} />
        </TabPanel>
        <TabPanel value="participants">
          <ParticipantsTab event={event} />
        </TabPanel>
        <TabPanel value="wishlists">
          <WishlistsTab event={event} />
        </TabPanel>
        {/* TODO(prompt 23): event chats. */}
        <TabPanel value="chat">
          <ComingSoon />
        </TabPanel>
        {event.my_role === 'host' && (
          <TabPanel value="manage">
            <ManageTab event={event} />
          </TabPanel>
        )}
      </Tabs>
    </>
  );
}

function ComingSoon() {
  const { t } = useTranslation();
  return <p className="text-body text-charcoal">{t('events.detail.comingSoon')}</p>;
}
