import { useSyncExternalStore } from 'react';

/**
 * Chrome/Edge/Android's `beforeinstallprompt` (FR-PWA-3). It fires once, early, often
 * before the dashboard mounts, so `listenForInstallPrompt()` runs at startup, keeps the
 * event, and components read it through `useInstallPrompt()`.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => {
    listener();
  });
}

function onBeforeInstallPrompt(event: Event) {
  event.preventDefault(); // no mini-infobar: the dashboard banner offers it instead
  deferred = event as BeforeInstallPromptEvent;
  emit();
}

function onInstalled() {
  deferred = null;
  installed = true;
  emit();
}

/** Call once at startup. Returns the cleanup (tests). */
export function listenForInstallPrompt(target: Window = window): () => void {
  target.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  target.addEventListener('appinstalled', onInstalled);
  return () => {
    target.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    target.removeEventListener('appinstalled', onInstalled);
  };
}

/** Show the browser's install dialog. The event is single-use either way. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred;
  if (!event) return 'unavailable';
  deferred = null;
  emit();
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === 'accepted') installed = true;
  emit();
  return outcome;
}

/** For tests: forget everything. */
export function resetInstallPrompt(): void {
  deferred = null;
  installed = false;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useInstallPrompt(): { canPrompt: boolean; installed: boolean } {
  const canPrompt = useSyncExternalStore(subscribe, () => deferred !== null);
  const done = useSyncExternalStore(subscribe, () => installed);
  return { canPrompt, installed: done };
}
