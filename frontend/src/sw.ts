/// <reference lib="webworker" />
/**
 * The service worker (CLAUDE.md §8, FR-PWA-2), built by vite-plugin-pwa's injectManifest.
 *
 * - precaches the app shell; navigations fall back to index.html, except /api and /ws
 * - API calls always go to the network, never to a cache (no offline writes in v1)
 * - push → a notification; a click focuses/navigates a tab or opens one (./sw/handlers)
 */
import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';

import { handleNotificationClick, handlePush } from './sw/handlers';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(({ url }) => url.pathname.startsWith('/api/'), new NetworkOnly());

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api(\/|$)/, /^\/ws(\/|$)/],
    // In `pnpm dev` only index.html is precached and Vite serves the modules: fall back for
    // the root only, so dev-server URLs keep working.
    ...(import.meta.env.DEV ? { allowlist: [/^\/$/] } : {}),
  }),
);

self.addEventListener('push', (event) => {
  handlePush(self, event);
});
self.addEventListener('notificationclick', (event) => {
  handleNotificationClick(self, event);
});

// A new version takes over on the next load instead of waiting for every tab to close.
void self.skipWaiting();
clientsClaim();
