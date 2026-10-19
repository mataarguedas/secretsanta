import { useEffect, useId, useMemo, useRef, useState } from 'react';
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
 * The owner's 3-slot photo uploader for a saved item (PRD §9.3). Filled slots show the
 * thumbnail and a Remove pill; an upload in flight shows its progress; each empty slot is
 * a dashed square holding an "Add photo" pill. There are only ever three slots, so a 4th
 * photo is never offered. Uploads start as soon as a file is picked, independent of the
 * item form.
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
  const upload = useUploadPhoto(eventId, ownerId);
  const remove = useDeletePhoto(eventId, ownerId);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const nextKey = useRef(0);

  const photos = item.photos.slice(0, MAX_PHOTOS);

  const start = (file: File) => {
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

  const slots: Slot[] = [
    ...photos.map((photo, i): Slot => ({
      kind: 'photo',
      key: photo.id,
      source: photo.thumb_url,
      alt: t('wishlist.photos.alt', { title: item.title, n: i + 1, total: photos.length }),
      removing: removing === photo.id,
      onRemove: () => {
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
      },
    })),
    ...uploads.map((u): Slot => ({
      kind: 'upload',
      key: `upload-${String(u.key)}`,
      progress: u.progress,
    })),
  ];

  return <PhotoSlots slots={slots} removeDisabled={removing !== null} onPick={start} />;
}

/** A photo picked for an item that doesn't exist yet; it uploads once the item is saved. */
export interface StagedPhoto {
  key: number;
  file: File;
  /** null until its upload starts; then 0…1. */
  progress: number | null;
}

/**
 * The same three slots for the "Add item" sheet: picked files are previewed locally and
 * kept until the item is created, then uploaded by the caller (which sets `progress`).
 */
export function StagedPhotoPicker({
  photos,
  busy,
  onAdd,
  onRemove,
}: {
  photos: StagedPhoto[];
  /** The item is being saved: nothing can be added or removed. */
  busy: boolean;
  onAdd: (file: File) => void;
  onRemove: (key: number) => void;
}) {
  const { t } = useTranslation();
  const slots = photos.slice(0, MAX_PHOTOS).map((photo, i): Slot =>
    photo.progress === null
      ? {
          kind: 'photo',
          key: `staged-${String(photo.key)}`,
          source: photo.file,
          alt: t('wishlist.photos.stagedAlt', { n: i + 1 }),
          removing: false,
          onRemove: () => {
            onRemove(photo.key);
          },
        }
      : { kind: 'upload', key: `staged-${String(photo.key)}`, progress: photo.progress },
  );
  return <PhotoSlots slots={slots} removeDisabled={busy} addDisabled={busy} onPick={onAdd} />;
}

type Slot =
  | {
      kind: 'photo';
      key: string;
      /** A URL, or a local file previewed through an object URL. */
      source: string | File;
      alt: string;
      removing: boolean;
      onRemove: () => void;
    }
  | { kind: 'upload'; key: string; progress: number };

function PhotoSlots({
  slots,
  removeDisabled,
  addDisabled = false,
  onPick,
}: {
  slots: Slot[];
  removeDisabled: boolean;
  addDisabled?: boolean;
  onPick: (file: File) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const titleId = useId();
  const helpId = useId();
  const input = useRef<HTMLInputElement>(null);
  const free = Math.max(MAX_PHOTOS - slots.length, 0);

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
          if (!file) return;
          if (file.size > MAX_UPLOAD_BYTES) {
            toast.error(t('errors.FILE_TOO_LARGE'));
            return;
          }
          onPick(file);
        }}
      />
      <ul className="grid grid-cols-3 gap-10">
        {slots.map((slot, i) => {
          const n = i + 1;
          if (slot.kind === 'photo') {
            return (
              <li key={slot.key} className="flex flex-col items-center gap-6">
                <Thumb source={slot.source} alt={slot.alt} />
                <Button
                  variant="nav"
                  iconOnly
                  aria-label={t('wishlist.photos.removeLabel', { n })}
                  loading={slot.removing}
                  disabled={removeDisabled}
                  onClick={slot.onRemove}
                >
                  <CloseIcon />
                </Button>
              </li>
            );
          }
          const percent = Math.round(slot.progress * 100);
          return (
            <li
              key={slot.key}
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
          const n = slots.length + i + 1;
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
                disabled={addDisabled}
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

/**
 * A slot's thumbnail. A local file is shown through an object URL (released on change or
 * unmount); if the browser can't decode it (HEIC outside Safari), its name stands in.
 */
function Thumb({ source, alt }: { source: string | File; alt: string }) {
  const local = typeof source === 'string' ? null : source;
  const objectUrl = useMemo(() => (local ? URL.createObjectURL(local) : null), [local]);
  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );
  const [failed, setFailed] = useState(false);

  if (local && failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className="flex aspect-square w-full items-center justify-center overflow-hidden border border-mist bg-pure-white p-6 text-center text-sm break-all text-stone"
      >
        {local.name}
      </div>
    );
  }
  return (
    <img
      src={objectUrl ?? (source as string)}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => {
        setFailed(true);
      }}
      className="aspect-square w-full border border-mist bg-pure-white object-cover"
    />
  );
}
