import { useState } from 'react';

import { cn } from '@/lib/cn';
import { initials } from '@/lib/initials';

export type AvatarSize = 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: 'size-[32px] text-caption',
  md: 'size-[44px] text-sm',
  lg: 'size-[64px] text-subheading',
};

interface BaseProps {
  size?: AvatarSize;
  /** Accessible name, always from props (e.g. the member's display name). */
  alt: string;
  className?: string;
}

interface PersonProps extends BaseProps {
  anonymous?: false;
  src?: string | null | undefined;
  /** Used for the initials fallback; defaults to `alt`. */
  name?: string;
}

/**
 * Anonymous members (Secret Elf #N) never get an image or a name. The type forbids both,
 * so a real identity can't leak through this component (CLAUDE.md §2.2).
 */
interface AnonymousProps extends BaseProps {
  anonymous: true;
  src?: never;
  name?: never;
}

export type AvatarProps = PersonProps | AnonymousProps;

export function Avatar(props: AvatarProps) {
  const { size = 'md', alt, className } = props;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const circle = cn(
    'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full-2 border border-ink-black select-none',
    SIZE_CLASSES[size],
    className,
  );

  if (props.anonymous) {
    return (
      <span role="img" aria-label={alt} className={cn(circle, 'bg-cream-linen font-mono')}>
        <span aria-hidden="true">✦</span>
      </span>
    );
  }

  const { src } = props;
  if (src && src !== failedSrc) {
    return (
      <span className={cn(circle, 'bg-bone')}>
        <img
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          onError={() => {
            setFailedSrc(src);
          }}
          className="size-full object-cover"
        />
      </span>
    );
  }

  return (
    <span role="img" aria-label={alt} className={cn(circle, 'bg-bone font-sans text-charcoal')}>
      <span aria-hidden="true">{initials(props.name ?? alt)}</span>
    </span>
  );
}
