import { cloneElement, isValidElement, type HTMLAttributes, type ReactElement } from 'react';

import { cn } from '@/lib/cn';

export type SlotProps = HTMLAttributes<HTMLElement> & { children: ReactElement };

/**
 * Render the single child element instead of a wrapper, merging our props and classes
 * into it (`asChild` pattern). Used to style router `<Link>`s and `<a>`s as primitives.
 */
export function Slot({ children, className, ...props }: SlotProps) {
  if (!isValidElement<{ className?: string }>(children)) {
    throw new Error('Slot expects a single React element child');
  }
  return cloneElement(children, {
    ...props,
    ...children.props,
    className: cn(className, children.props.className),
  });
}
