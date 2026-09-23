import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';

import { BottomTabBar } from './BottomTabBar';
import { DesktopHeader } from './DesktopHeader';
import { Wordmark } from './Wordmark';

/**
 * App shell: desktop header ≥ 768px; compact wordmark bar + fixed bottom tab bar below.
 * Content is `max-w-[1200px] mx-auto` with 32px / 64px section gaps (CLAUDE.md §6.2) and
 * bottom padding on mobile so nothing hides behind the tab bar.
 */
export function AppLayout() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-full-2 border border-ink-black bg-pure-white px-19 py-6 text-sm focus:not-sr-only focus:fixed focus:top-8 focus:left-8"
      >
        {t('nav.skipToContent')}
      </a>

      {/* One banner landmark; each row shows at its own breakpoint. */}
      <header>
        <DesktopHeader className="hidden md:grid" />
        <div className="flex justify-center px-16 pt-8 md:hidden">
          <Wordmark className="text-subheading" />
        </div>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-32 px-16 pt-24 pb-[calc(96px+env(safe-area-inset-bottom))] outline-none md:gap-[64px] md:px-20 md:pt-40 md:pb-[64px]"
      >
        <Outlet />
      </main>

      <BottomTabBar className="md:hidden" />
    </div>
  );
}
