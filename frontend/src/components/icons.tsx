import type { ReactNode, SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>;

/** 20px line icons. Decorative: pair them with visible text or an aria-label on the control. */
function Icon({ children, className = 'size-20', ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {children}
    </svg>
  );
}

/** Gift box: Events. */
export function GiftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="7.5" width="14" height="10" />
      <path d="M2 5h16v2.5H2zM10 5v12.5M10 5C8.5 2 5.5 2.5 6.5 4.5 7 5 10 5 10 5zm0 0c1.5-3 4.5-2.5 3.5-.5-.5.5-3.5.5-3.5.5z" />
    </Icon>
  );
}

/** Speech bubble: Chats. */
export function ChatIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 4h14v9.5H8L4.5 16.5V13.5H3z" />
    </Icon>
  );
}

/** Head and shoulders: Profile. */
export function PersonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="7" r="3.5" />
      <path d="M3.5 17.5c.8-3.3 3.4-5 6.5-5s5.7 1.7 6.5 5" />
    </Icon>
  );
}

/** Tick in a circle: a positive status. */
export function CheckCircleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M6.5 10.5l2.3 2.3 4.7-5.3" />
    </Icon>
  );
}

/** Exclamation in a circle: a blocking status. */
export function AlertCircleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6v5M10 13.75v.25" />
    </Icon>
  );
}

/** Diagonal cross: remove / close. */
export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 5l10 10M15 5L5 15" />
    </Icon>
  );
}

/** Arrow up: move earlier in a list. */
export function ArrowUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 16V4M5 9l5-5 5 5" />
    </Icon>
  );
}

/** Arrow down: move later in a list. */
export function ArrowDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 4v12M5 11l5 5 5-5" />
    </Icon>
  );
}

/** Plus: add something (e.g. a photo to an empty slot). */
export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 4v12M4 10h12" />
    </Icon>
  );
}
