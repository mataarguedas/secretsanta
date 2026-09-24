import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useToast } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

import { useCreateEvent, useUploadCover } from '../api';
import { CoverPicker } from '../components/CoverPicker';
import { EventForm } from '../components/EventForm';
import { toCreatePayload } from '../schemas';

/**
 * `/events/new` (FR-EVT-1). The cover is optional and uploads right after the event is
 * created (it needs the event id); then the event page opens. A failed photo upload never
 * loses the event: the host is told to add the photo from Manage.
 */
export function CreateEventPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateEvent();
  const upload = useUploadCover();
  const [cover, setCover] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  useDocumentTitle(t('events.create.title'));

  // A local object URL for the preview, released when the file changes or on leave.
  const preview = useMemo(() => (cover ? URL.createObjectURL(cover) : null), [cover]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  return (
    <section className="flex flex-col gap-24">
      <h1 className="font-serif text-heading font-medium md:text-heading-lg">
        {t('events.create.title')}
      </h1>
      <EventForm
        submitLabel={t('events.create.submit')}
        onSubmit={async (values) => {
          const event = await create.mutateAsync(toCreatePayload(values));
          if (cover) {
            setProgress(0);
            try {
              await upload.mutateAsync({ eventId: event.id, file: cover, onProgress: setProgress });
            } catch (error) {
              toast.error(`${t('events.cover.createFailed')} ${errorMessage(t, error)}`);
            }
          }
          await navigate(`/events/${event.id}`);
        }}
      >
        <CoverPicker
          previewUrl={preview}
          previewAlt={t('events.cover.previewAlt')}
          progress={progress}
          busy={create.isPending || upload.isPending}
          onPick={setCover}
          onRemove={() => {
            setCover(null);
          }}
        />
      </EventForm>
    </section>
  );
}
