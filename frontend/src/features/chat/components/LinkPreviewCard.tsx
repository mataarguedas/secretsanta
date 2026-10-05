import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui';

import type { LinkPreview } from '../api';

/**
 * The preview of a message's first link: picture, site, title and description, as one
 * interactive card that opens the link in a new tab. A video gets a play mark over its
 * picture. The picture is the server's own copy, so viewing it tells the linked site nothing.
 */
export function LinkPreviewCard({ preview }: { preview: LinkPreview }) {
  const { t } = useTranslation();
  // Presigned URLs expire after an hour; a stale one just hides the picture.
  const [imageFailed, setImageFailed] = useState(false);
  const site = preview.site_name ?? hostOf(preview.url);
  const title = preview.title ?? site;
  const showImage = preview.image_url !== null && !imageFailed;
  const ratio =
    preview.image_width && preview.image_height
      ? `${String(preview.image_width)} / ${String(preview.image_height)}`
      : undefined;

  return (
    <Card asChild className="w-72 max-w-full overflow-hidden p-0 md:w-80">
      <a
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer nofollow ugc"
        aria-label={t(preview.is_video ? 'chat.preview.videoLabel' : 'chat.preview.label', {
          title,
          site,
        })}
        data-testid="link-preview"
      >
        {showImage && (
          <span className="relative block border-b border-mist bg-bone">
            <img
              src={preview.image_url ?? undefined}
              alt=""
              loading="lazy"
              decoding="async"
              width={preview.image_width ?? undefined}
              height={preview.image_height ?? undefined}
              style={ratio ? { aspectRatio: ratio } : undefined}
              className="block max-h-60 w-full object-cover"
              onError={() => {
                setImageFailed(true);
              }}
            />
            {preview.is_video && (
              <span
                aria-hidden="true"
                className="absolute top-1/2 left-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full-2 border border-ink-black bg-cream-linen text-body text-ink-black"
              >
                ▶
              </span>
            )}
          </span>
        )}
        <span className="flex flex-col gap-6 px-15 py-12">
          {site && (
            <span className="truncate font-mono text-caption tracking-[0.056em] text-stone uppercase">
              {site}
            </span>
          )}
          <span className="line-clamp-2 text-body break-words text-ink-black">{title}</span>
          {preview.description && (
            <span className="line-clamp-2 text-sm break-words text-charcoal">
              {preview.description}
            </span>
          )}
        </span>
      </a>
    </Card>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
