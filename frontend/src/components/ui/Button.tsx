import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { buttonClasses, type ButtonVariant } from './classes';
import { Slot } from './Slot';

interface BaseProps {
  variant: ButtonVariant;
  /** Only for the sticky submit of a mobile form: full width below md, content-sized above. */
  fullWidthOnMobile?: boolean;
  className?: string;
}

/** Icon-only buttons must carry a (translated) accessible name. */
type LabelProps = { iconOnly: true; 'aria-label': string } | { iconOnly?: false };

type NativeProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  asChild?: false;
  /** Shows a spinner, sets aria-busy and disables the button. */
  loading?: boolean;
  children?: ReactNode;
};

type AsChildProps = Omit<HTMLAttributes<HTMLElement>, 'className' | 'children'> & {
  /** Style the single child (e.g. a router `<Link>`) as a button instead of rendering one. */
  asChild: true;
  children: ReactElement;
  loading?: never;
  disabled?: never;
};

export type ButtonProps = BaseProps & LabelProps & (NativeProps | AsChildProps);

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-16 animate-spin rounded-full-2 border-2 border-current border-r-transparent motion-reduce:animate-none"
    />
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const { t } = useTranslation();
  const classes = buttonClasses({
    variant: props.variant,
    iconOnly: props.iconOnly ?? false,
    fullWidthOnMobile: props.fullWidthOnMobile ?? false,
    className: props.className,
  });

  if (props.asChild) {
    const {
      variant: _v,
      iconOnly: _i,
      fullWidthOnMobile: _f,
      className: _c,
      asChild: _a,
      children,
      ...rest
    } = props;
    return (
      <Slot {...rest} className={classes}>
        {children}
      </Slot>
    );
  }

  const {
    variant: _v,
    iconOnly: _i,
    fullWidthOnMobile: _f,
    className: _c,
    asChild: _a,
    loading = false,
    disabled,
    type = 'button',
    children,
    ...rest
  } = props;

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={classes}
      {...rest}
    >
      {loading && (
        <>
          <Spinner />
          <span className="sr-only">{t('ui.button.loading')}</span>
        </>
      )}
      {children}
    </button>
  );
});
