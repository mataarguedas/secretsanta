import type { HTMLAttributes, ReactElement, ReactNode } from 'react';

import { cardClasses, type CardVariant } from './classes';
import { Slot } from './Slot';

type CardElement = 'div' | 'article' | 'section' | 'li';

interface BaseProps {
  /** `content`: mist border. `interactive`: black border (CLAUDE.md §6.2). */
  variant?: CardVariant;
  className?: string;
}

type ElementProps = BaseProps &
  Omit<HTMLAttributes<HTMLElement>, 'className'> & {
    as?: CardElement;
    asChild?: false;
    children?: ReactNode;
  };

/**
 * `asChild`: render the child (e.g. a router `<Link>`) as the card, so the whole card is
 * a single focus stop. Defaults to the interactive variant.
 */
type AsChildProps = BaseProps &
  Omit<HTMLAttributes<HTMLElement>, 'className' | 'children'> & {
    asChild: true;
    children: ReactElement;
  };

export type CardProps = ElementProps | AsChildProps;

export function Card(props: CardProps) {
  if (props.asChild) {
    const { variant = 'interactive', className, asChild: _a, children, ...rest } = props;
    return (
      <Slot {...rest} className={cardClasses(variant, className)}>
        {children}
      </Slot>
    );
  }
  const { variant = 'content', className, as: Tag = 'div', asChild: _a, ...rest } = props;
  return <Tag className={cardClasses(variant, className)} {...rest} />;
}
