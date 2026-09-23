import { useEffect, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { registerBanner } from './bannerRegistry';

export interface BannerProps {
  children: ReactNode;
  /** Optional action (e.g. a `nav` Button) under the text. */
  action?: ReactNode;
  as?: 'p' | 'h2' | 'h3';
  className?: string;
}

/**
 * The coral strip, the only large coral surface in the system. At most one per screen
 * (CLAUDE.md §6.2); in development a warning fires when two are mounted at once.
 */
export function Banner({ children, action, as: Tag = 'p', className }: BannerProps) {
  useEffect(registerBanner, []);

  return (
    <section
      className={cn(
        'flex min-h-[120px] w-full flex-col items-center justify-center gap-15 bg-coral-pop px-20 py-24 text-center',
        className,
      )}
    >
      <Tag className="font-serif text-heading font-medium text-pure-white">{children}</Tag>
      {action}
    </section>
  );
}
