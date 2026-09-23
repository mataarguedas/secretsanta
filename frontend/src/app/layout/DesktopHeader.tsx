import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { Avatar } from '@/components/ui';
import type { Me } from '@/features/auth/api';
import { cn } from '@/lib/cn';

import { NAV_ITEMS } from './navItems';
import { Wordmark } from './Wordmark';

/**
 * ≥ 768px header row: nav pills (Events, Chats) on the left, the centered wordmark, and the
 * profile avatar on the right (PRD §9.2).
 */
export function DesktopHeader({
  user,
  className,
}: {
  user: Pick<Me, 'name' | 'avatar_url'>;
  className?: string;
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const profile = NAV_ITEMS.find((item) => item.key === 'profile');

  return (
    <div
      className={cn(
        'mx-auto w-full max-w-[1200px] grid-cols-[1fr_auto_1fr] items-center gap-15 px-20 py-20',
        className,
      )}
    >
      <nav aria-label={t('nav.primary')}>
        <ul className="flex gap-10">
          {NAV_ITEMS.filter((item) => item.key !== 'profile').map((item) => {
            const active = item.isActive(pathname);
            return (
              <li key={item.key}>
                <Link
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-11 items-center rounded-full-2 border px-19 py-6 text-sm transition-colors',
                    // Selected navigation = coral fill (DESIGN.md). Black text keeps 14px legible.
                    active
                      ? 'border-coral-pop bg-coral-pop text-ink-black'
                      : 'border-ink-black text-ink-black hover:bg-pure-white',
                  )}
                >
                  {t(item.labelKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Wordmark className="text-heading" />

      <div className="flex justify-end">
        {profile && (
          <Link
            to={profile.to}
            aria-current={profile.isActive(pathname) ? 'page' : undefined}
            className="rounded-full-2"
          >
            {/* Google photo, initials of the user's name if it's missing or fails to load. */}
            <Avatar size="md" src={user.avatar_url} name={user.name} alt={t('nav.profile')} />
          </Link>
        )}
      </div>
    </div>
  );
}
