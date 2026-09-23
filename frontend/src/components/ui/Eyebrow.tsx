import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export interface EyebrowProps extends HTMLAttributes<HTMLElement> {
  as?: 'p' | 'span';
}

/** Tracked-out mono uppercase label: OPEN, DRAWN, ARCHIVED, HOSTING, SECRET ELF #N. */
export function Eyebrow({ as: Tag = 'p', className, ...props }: EyebrowProps) {
  return (
    <Tag
      className={cn('font-mono text-sm tracking-[0.056em] text-coral-pop uppercase', className)}
      {...props}
    />
  );
}
