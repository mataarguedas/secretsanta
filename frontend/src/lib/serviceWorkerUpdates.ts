/**
 * Keeps the installed PWA on the latest deploy (FR-PWA-2).
 *
 * The service worker precaches the app shell, so the app always starts from the cached
 * version; a new deploy only arrives when the browser finds a new `sw.js`. Browsers look on
 * page loads, but an installed iOS PWA brought back from the background doesn't load a page,
 * so it would stay on an old version for as long as it lives in the app switcher. So:
 * - check for a new worker on launch, whenever the app comes back to the foreground, when the
 *   connection returns, and every hour while it's on screen;
 * - `sw.ts` activates a new worker right away (skipWaiting + clientsClaim), and once it has
 *   taken over, the page reloads onto the new version (old lazy chunks no longer exist on
 *   the server, so the old page can't keep running safely);
 * - never in the middle of a typed message: then the reload waits until the app is hidden.
 */

/** The bits of vite-plugin-pwa's `registerSW` used here (main.tsx passes the real one). */
export type RegisterSW = (options: {
  immediate?: boolean;
  onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
  onNeedReload?: () => void;
  onRegisterError?: (error: unknown) => void;
}) => unknown;

/** How often an app left on screen looks for a new version. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

function reloadPage(): void {
  window.location.reload();
}

/** A text field with something typed in it has focus: reloading now would lose it. */
function hasUnsentText(): boolean {
  const active = document.activeElement;
  return (
    (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) &&
    active.value.trim().length > 0
  );
}

/** Reloads now, or, while the user is typing, as soon as the app goes to the background. */
export function reloadWhenSafe(reload: () => void = reloadPage): void {
  if (!hasUnsentText()) {
    reload();
    return;
  }
  const onHidden = () => {
    if (document.visibilityState !== 'hidden') return;
    document.removeEventListener('visibilitychange', onHidden);
    reload();
  };
  document.addEventListener('visibilitychange', onHidden);
}

/** Asks the browser to fetch `sw.js` again; installs and activates it if it changed. */
function checkForUpdate(registration: ServiceWorkerRegistration): void {
  if (!navigator.onLine) return;
  registration.update().catch(() => {
    // Offline or a failed fetch: the next trigger tries again.
  });
}

export function startServiceWorkerUpdates(
  registerSW: RegisterSW,
  reload: () => void = reloadPage,
): void {
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const check = () => {
        checkForUpdate(registration);
      };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.addEventListener('online', check);
      window.setInterval(() => {
        if (document.visibilityState === 'visible') check();
      }, UPDATE_CHECK_INTERVAL_MS);
    },
    onNeedReload() {
      reloadWhenSafe(reload);
    },
  });
}
