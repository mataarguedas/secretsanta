import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { linkify } from '@/lib/linkify';

/**
 * A chat message body with its URLs as tappable links. Links open in a new tab and never
 * send a referrer, so the thread URL (and with it the conversation id) stays private.
 */
export function MessageText({ text }: { text: string }) {
  const { t } = useTranslation();
  const segments = useMemo(() => linkify(text), [text]);

  return segments.map((segment, index) =>
    segment.kind === 'text' ? (
      segment.text
    ) : (
      <a
        // Segments come from an immutable body; the index is a stable key.
        key={index}
        href={segment.href}
        target="_blank"
        rel="noopener noreferrer nofollow ugc"
        className="rounded-full-2 break-all text-ink-black underline underline-offset-4 hover:text-charcoal"
      >
        {segment.text}
        <span className="sr-only"> {t('chat.message.linkNewTab')}</span>
      </a>
    ),
  );
}
