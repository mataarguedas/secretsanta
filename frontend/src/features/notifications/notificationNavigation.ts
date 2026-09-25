import { NAVIGATE_MESSAGE, type NavigateMessage } from '@/sw/handlers';

function isNavigateMessage(data: unknown): data is NavigateMessage {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Partial<NavigateMessage>;
  return (
    message.type === NAVIGATE_MESSAGE &&
    typeof message.url === 'string' &&
    message.url.startsWith('/') &&
    !message.url.startsWith('//')
  );
}

/**
 * A tapped notification focuses an open tab and asks it to go to the notification's page
 * (`sw/handlers.ts`); the app navigates client-side, keeping its socket and cache.
 * Returns the cleanup.
 */
export function listenForNotificationNavigation(
  navigate: (path: string) => unknown,
  container:
    | Pick<ServiceWorkerContainer, 'addEventListener' | 'removeEventListener'>
    | undefined = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    ? navigator.serviceWorker
    : undefined,
): () => void {
  if (!container) return () => undefined;
  const onMessage = (event: MessageEvent) => {
    if (isNavigateMessage(event.data)) navigate(event.data.url);
  };
  container.addEventListener('message', onMessage as EventListener);
  return () => {
    container.removeEventListener('message', onMessage as EventListener);
  };
}
