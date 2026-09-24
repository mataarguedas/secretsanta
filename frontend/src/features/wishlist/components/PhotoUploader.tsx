import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CloseIcon, PlusIcon } from '@/components/icons';
import { Button, useToast } from '@/components/ui';
import { COVER_ACCEPT, MAX_UPLOAD_BYTES } from '@/features/events/api';
import { errorMessage } from '@/lib/errors';

import { useDeletePhoto, useUploadPhoto, type WishlistItem } from '../api';

/** FR-WSH-2: 0–3 photos per item. */
export const MAX_PHOTOS = 3;

interface Upload {
  key: number;
  /** 0…1 */
  progress: number;
}

/**
 * The owner's 3-slot photo uploader (PRD §9.3). Filled slots show the thumbnail and a
 * Remove pill; an upload in flight shows its progress; each empty slot is a dashed square
 * holding an "Add photo" pill. There are only ever three slots, so a 4th photo is never
 * offered. Uploads start as soon as a file is picked, independent of the item form.
 */
export function PhotoUploader({
  eventId,
  ownerId,
  item,
}: {
  eventId: string;
  ownerId: string;
  item: WishlistItem;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const titleId = useId();
  const helpId = useId();
  const input = useRef<HTMLInputElement>(null);
  const upload = useUploadPhoto(eventId, ownerId);
  const remove = useDeletePhoto(eventId, ownerId);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const nextKey = useRef(0);

  const photos = item.photos.slice(0, MAX_PHOTOS);
  const free = Math.max(MAX_PHOTOS - photos.length - uploads.length, 0);

  const start = (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(t('errors.FILE_TOO_LARGE'));
      return;
    }
    nextKey.current += 1;
    const key = nextKey.current;
    setUploads((current) => [...current, { key, progress: 0 }]);
    upload.mutate(
      {
        itemId: item.id,
        file,
        onProgress: (progress) => {
          setUploads((current) => current.map((u) => (u.key === key ? { ...u, progress } : u)));
        },
      },
      {
        onError: (error) => toast.error(errorMessage(t, error)),
        onSettled: () => {
          setUploads((current) => current.filter((u) => u.key !== key));
        },
      },
    );
  };

  return (
    <div role="group" aria-labelledby={titleId} className="flex flex-col gap-12">
      <p id={titleId} className="text-body">
        {t('wishlist.photos.title')}
      </p>
      <p id={helpId} className="text-sm text-stone">
        {t('wishlist.photos.help')}
      </p>
      <input
        ref={input}
        type="file"
        accept={COVER_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="photo-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // picking the same file again must fire change
          if (file) start(file);
        }}
      />
      <ul className="grid grid-cols-3 gap-10">
        {photos.map((photo, i) => (
          <li key={photo.id} className="flex flex-col items-center gap-6">
            <img
              src={photo.thumb_url}
              alt={t('wishlist.photos.alt', {
                title: item.title,
                n: i + 1,
                total: photos.length,
              })}
              loading="lazy"
              decoding="async"
              className="aspect-square w-full border border-mist bg-pure-white object-cover"
            />
            <Button
              variant="nav"
              iconOnly
              aria-label={t('wishlist.photos.removeLabel', { n: i + 1 })}
              loading={removing === photo.id}
              disabled={removing !== null}
              onClick={() => {
                setRemoving(photo.id);
                remove.mutate(
                  { itemId: item.id, photoId: photo.id },
                  {
                    onError: (error) => toast.error(errorMessage(t, error)),
                    onSettled: () => {
                      setRemoving(null);
                    },
                  },
                );
              }}
            >
              <CloseIcon />
            </Button>
          </li>
        ))}
        {uploads.map((u, i) => {
          const n = photos.length + i + 1;
          const percent = Math.round(u.progress * 100);
          return (
            <li
              key={`upload-${String(u.key)}`}
              aria-label={t('wishlist.photos.slotLabel', { n })}
              className="flex aspect-square flex-col items-center justify-center gap-6 border border-dashed border-stone p-8"
            >
              <div
                role="progressbar"
                aria-label={t('wishlist.photos.progressLabel', { n })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="h-6 w-full overflow-hidden rounded-full-2 border border-ink-black bg-bone"
              >
                <div
                  className="h-full bg-ink-black transition-[width] motion-reduce:transition-none"
                  style={{ width: `${String(percent)}%` }}
                />
              </div>
              <p className="text-center text-sm text-stone">
                {t('wishlist.photos.uploading', { percent })}
              </p>
            </li>
          );
        })}
        {Array.from({ length: free }, (_, i) => {
          const n = photos.length + uploads.length + i + 1;
          return (
            <li
              key={`free-${String(n)}`}
              aria-label={t('wishlist.photos.slotLabel', { n })}
              className="flex aspect-square flex-col items-center justify-center gap-6 border border-dashed border-stone p-6"
            >
              <Button
                variant="nav"
                iconOnly
                aria-label={t('wishlist.photos.addLabel', { n })}
                aria-describedby={helpId}
                onClick={() => input.current?.click()}
              >
                <PlusIcon />
              </Button>
              <span aria-hidden="true" className="text-center text-sm text-charcoal">
                {t('wishlist.photos.add')}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
