import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { cn } from '@/lib/cn';

import { NAV_ITEMS } from './navItems';
import { UnreadBadge, UnreadLabel } from './UnreadBadge';

/**
 * < 768px fixed tab bar: Events · Chats · Profile. The active tab is a coral pill;
 * `env(safe-area-inset-bottom)` keeps it above the iOS home indicator (PRD §9.4).
 */
export function BottomTabBar({ unread = 0, className }: { unread?: number; className?: string }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  return (
    <nav
      aria-label={t('nav.tabs')}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-ink-black bg-cream-linen pb-[env(safe-area-inset-bottom)]',
        className,
      )}
    >
      {/* Fixed height (plus the 1px border = --tab-bar-height) so sticky actions can sit on it. */}
      <ul className="mx-auto flex h-[70px] max-w-[640px] items-center justify-around px-8">
        {NAV_ITEMS.map(({ key, to, labelKey, Icon, isActive }) => {
          const active = isActive(pathname);
          return (
            <li key={key} className="flex flex-1 justify-center">
              <Link
                to={to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 min-w-[72px] flex-col items-center justify-center gap-[2px] rounded-full-2 px-15 py-6 text-sm transition-colors',
                  active ? 'bg-coral-pop text-ink-black' : 'text-ink-black hover:bg-pure-white',
                )}
              >
                <span className="relative inline-flex">
                  <Icon />
                  {key === 'chats' && (
                    <UnreadBadge count={unread} className="absolute -top-6 -right-12" />
                  )}
                </span>
                <span>{t(labelKey)}</span>
                {key === 'chats' && <UnreadLabel count={unread} />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
