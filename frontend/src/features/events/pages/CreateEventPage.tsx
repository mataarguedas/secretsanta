import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useDocumentTitle } from '@/lib/useDocumentTitle';

import { useCreateEvent } from '../api';
import { EventForm } from '../components/EventForm';
import { toCreatePayload } from '../schemas';

/** `/events/new` (FR-EVT-1). On success the event page opens. */
export function CreateEventPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateEvent();
  useDocumentTitle(t('events.create.title'));

  return (
    <section className="flex flex-col gap-24">
      <h1 className="font-serif text-heading font-medium md:text-heading-lg">
        {t('events.create.title')}
      </h1>
      <EventForm
        submitLabel={t('events.create.submit')}
        onSubmit={async (values) => {
          const event = await create.mutateAsync(toCreatePayload(values));
          await navigate(`/events/${event.id}`);
        }}
      />
    </section>
  );
}
