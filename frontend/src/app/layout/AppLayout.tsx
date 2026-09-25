import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router';

import { useMe, type Me } from '@/features/auth/api';
import { useSyncLocale } from '@/features/auth/useSyncLocale';
import { useUnreadTotal } from '@/features/chat/api';
import { RealtimeProvider } from '@/features/chat/RealtimeProvider';
import { cn } from '@/lib/cn';
import { useVisualViewportHeight } from '@/lib/useVisualViewportHeight';

import { BottomTabBar } from './BottomTabBar';
import { DesktopHeader } from './DesktopHeader';
import { FullPageError, FullPageLoading } from './FullPageStatus';
import { Wordmark } from './Wordmark';

/**
 * App shell. Resolves the session first (full-page loading, no layout flash), then:
 * - signed in: desktop header ≥ 768px; compact wordmark bar + fixed bottom tab bar below;
 * - signed out: only the centered wordmark bar.
 * Content is `max-w-[1200px] mx-auto` with 32px / 64px section gaps (CLAUDE.md §6.2).
 *
 * A chat thread (`/chats/:id`) is full height instead: on mobile it drops the wordmark bar
 * and the tab bar, and it follows the visual viewport so the composer stays above the
 * keyboard. While signed in, the app's WebSocket runs (RealtimeProvider).
 */
export function AppLayout() {
  const session = useMe();
  const me = session.data;
  useSyncLocale(me?.locale);

  if (me === undefined) {
    if (session.isError) {
      return (
        <FullPageError
          retrying={session.isFetching}
          onRetry={() => {
            void session.refetch();
          }}
        />
      );
    }
    return <FullPageLoading />;
  }

  return (
    <RealtimeProvider enabled={me !== null}>
      <Shell me={me} />
    </RealtimeProvider>
  );
}

function Shell({ me }: { me: Me | null }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const signedIn = me !== null;
  const thread = signedIn && /^\/chats\/[^/]+\/?$/.test(pathname);
  const unread = useUnreadTotal(signedIn);
  useVisualViewportHeight(thread);

  return (
    <div
      className={cn(
        'flex flex-col',
        thread ? 'h-[var(--app-height,100dvh)] overflow-hidden' : 'min-h-dvh',
      )}
    >
      <a
        href="#main"
        className="sr-only z-50 rounded-full-2 border border-ink-black bg-pure-white px-19 py-6 text-sm focus:not-sr-only focus:fixed focus:top-8 focus:left-8"
      >
        {t('nav.skipToContent')}
      </a>

      {/* One banner landmark; each row shows at its own breakpoint. */}
      <header>
        {signedIn ? (
          <>
            <DesktopHeader user={me} unread={unread} className="hidden md:grid" />
            {!thread && (
              <div className="flex justify-center px-16 pt-8 md:hidden">
                <Wordmark className="text-subheading" />
              </div>
            )}
          </>
        ) : (
          <div className="flex justify-center px-16 pt-8 md:pt-20">
            <Wordmark className="text-subheading md:text-heading" />
          </div>
        )}
      </header>

      <main
        id="main"
        tabIndex={-1}
        className={cn(
          'mx-auto flex w-full max-w-[1200px] flex-1 flex-col outline-none',
          thread
            ? 'min-h-0 md:px-20 md:pb-20'
            : cn(
                'gap-32 px-16 pt-24 md:gap-[64px] md:px-20 md:pt-40 md:pb-[64px]',
                // Room for the fixed tab bar (signed in, mobile) so nothing hides behind it.
                signedIn ? 'pb-[calc(96px+env(safe-area-inset-bottom))]' : 'pb-32',
              ),
        )}
      >
        <Outlet />
      </main>

      {signedIn && !thread && <BottomTabBar unread={unread} className="md:hidden" />}
    </div>
  );
}
