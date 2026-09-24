import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, useToast } from '@/components/ui';
import { errorMessage } from '@/lib/errors';

import { useRemoveCover, useUploadCover, type EventDetail } from '../api';
import { CoverPicker } from './CoverPicker';

/** Manage › Cover photo (host, OPEN only): picking a file uploads it right away. */
export function CoverSection({ event }: { event: EventDetail }) {
  const { t } = useTranslation();
  const toast = useToast();
  const upload = useUploadCover();
  const remove = useRemoveCover(event.id);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card as="section" aria-label={t('events.cover.title')} className="flex flex-col gap-12">
      <CoverPicker
        previewUrl={event.cover_url}
        previewAlt={t('events.cover.alt', { name: event.name })}
        progress={progress}
        busy={upload.isPending || remove.isPending}
        error={error}
        onPick={(file) => {
          setError(null);
          setProgress(0);
          upload.mutate(
            { eventId: event.id, file, onProgress: setProgress },
            {
              onSuccess: () => toast.success(t('events.cover.uploaded')),
              onError: (e) => {
                setError(errorMessage(t, e));
              },
              onSettled: () => {
                setProgress(null);
              },
            },
          );
        }}
        onRemove={() => {
          setError(null);
          remove.mutate(undefined, {
            onSuccess: () => toast.success(t('events.cover.removed')),
            onError: (e) => {
              setError(errorMessage(t, e));
            },
          });
        }}
      />
    </Card>
  );
}
