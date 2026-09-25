import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';

/** Total unread messages on the Chats nav item. Black, never coral (the active pill is). */
export function UnreadBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full-2 bg-ink-black px-[5px] font-mono text-caption leading-none text-pure-white',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** Read after the link label: "Chats, 3 unread messages". */
export function UnreadLabel({ count }: { count: number }) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return <span className="sr-only">, {t('nav.unread', { count })}</span>;
}
