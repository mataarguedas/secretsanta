import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui';

import { COVER_ACCEPT, MAX_UPLOAD_BYTES } from '../api';

export interface CoverPickerProps {
  /** The current cover, or a local preview of the chosen file. */
  previewUrl: string | null;
  previewAlt: string;
  /** 0…1 while uploading, else null. */
  progress: number | null;
  busy?: boolean;
  /** A translated error to show under the controls. */
  error?: string | null;
  onPick: (file: File) => void;
  onRemove?: () => void;
}

/**
 * Cover photo field: square-cornered preview, a pill to choose/replace, an optional
 * Remove, and a progress bar. Files over 10 MB are refused before any upload; the server
 * still checks the real format.
 */
export function CoverPicker({
  previewUrl,
  previewAlt,
  progress,
  busy = false,
  error,
  onPick,
  onRemove,
}: CoverPickerProps) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const helpId = useId();
  const [localError, setLocalError] = useState<string | null>(null);
  // HEIC previews only render in Safari; elsewhere show a note instead of a broken image.
  const [brokenPreview, setBrokenPreview] = useState<string | null>(null);
  const shownError = localError ?? error ?? null;
  const percent = progress === null ? null : Math.round(progress * 100);

  return (
    <div role="group" aria-labelledby={titleId} className="flex flex-col gap-12">
      <p id={titleId} className="text-body">
        {t('events.cover.title')}
      </p>
      <p id={helpId} className="text-sm text-stone">
        {t('events.cover.help')}
      </p>

      {previewUrl &&
        (brokenPreview === previewUrl ? (
          <p className="text-sm text-charcoal">{t('events.cover.noPreview')}</p>
        ) : (
          <img
            src={previewUrl}
            alt={previewAlt}
            onError={() => {
              setBrokenPreview(previewUrl);
            }}
            className="aspect-video w-full max-w-[480px] rounded-none border border-mist object-cover"
          />
        ))}

      {percent !== null && (
        <div className="flex max-w-[480px] flex-col gap-6">
          <div
            role="progressbar"
            aria-label={t('events.cover.progressLabel')}
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
          <p className="text-sm text-stone">{t('events.cover.uploading', { percent })}</p>
        </div>
      )}

      <input
        ref={input}
        type="file"
        accept={COVER_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // picking the same file again must fire change
          if (!file) return;
          if (file.size > MAX_UPLOAD_BYTES) {
            setLocalError(t('errors.FILE_TOO_LARGE'));
            return;
          }
          setLocalError(null);
          onPick(file);
        }}
      />
      <div className="flex flex-wrap gap-10">
        <Button
          variant="nav"
          disabled={busy}
          aria-describedby={helpId}
          onClick={() => input.current?.click()}
        >
          {previewUrl ? t('events.cover.replace') : t('events.cover.choose')}
        </Button>
        {previewUrl && onRemove && (
          <Button variant="ghost" disabled={busy} onClick={onRemove}>
            {t('events.cover.remove')}
          </Button>
        )}
      </div>
      {shownError && (
        <p role="alert" className="text-sm text-error">
          {shownError}
        </p>
      )}
    </div>
  );
}
