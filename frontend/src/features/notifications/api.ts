import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/apiClient';

/** One of my push-enabled devices (backend `PushDevice`). */
export interface PushDevice {
  id: string;
  browser: string | null;
  os: string | null;
  created_at: string;
  last_success_at: string | null;
}

export const pushKeys = {
  all: ['push'] as const,
  devices: () => ['push', 'devices'] as const,
};

/** This browser's own row in `/push/subscriptions`, remembered from the last subscribe. */
const THIS_DEVICE_KEY = 'santa:push-device-id';

export function thisDeviceId(): string | null {
  try {
    return localStorage.getItem(THIS_DEVICE_KEY);
  } catch {
    return null; // storage blocked: we just can't label "this device"
  }
}

function rememberThisDevice(id: string | null): void {
  try {
    if (id) localStorage.setItem(THIS_DEVICE_KEY, id);
    else localStorage.removeItem(THIS_DEVICE_KEY);
  } catch {
    // ignore: see thisDeviceId
  }
}

/** Thrown when the browser side of subscribing fails (no service worker, push refused…). */
export class PushSetupError extends Error {
  override name = 'PushSetupError';
}

const SERVICE_WORKER_TIMEOUT_MS = 10_000;

async function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new PushSetupError('service worker not ready'));
    }, SERVICE_WORKER_TIMEOUT_MS);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The VAPID key, base64url → the bytes `applicationServerKey` wants. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sameKey(current: ArrayBuffer | null, wanted: Uint8Array): boolean {
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === wanted.length && bytes.every((b, i) => b === wanted[i]);
}

/**
 * Subscribe this browser and register it with the backend. The caller must already have
 * permission, asked from a click (FR-NTF-9). A subscription made with an old VAPID key is
 * replaced, since the push service would reject our pushes to it.
 */
export async function subscribeThisDevice(): Promise<PushDevice> {
  const { public_key: publicKey } = await apiClient.get<{ public_key: string }>(
    '/push/vapid-public-key',
  );
  const registration = await serviceWorkerRegistration();
  const applicationServerKey = base64UrlToBytes(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options.applicationServerKey, applicationServerKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  try {
    subscription ??= await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  } catch (error) {
    throw new PushSetupError(error instanceof Error ? error.message : 'subscribe failed');
  }
  const device = await apiClient.post<PushDevice>('/push/subscriptions', {
    ...subscription.toJSON(),
    user_agent: navigator.userAgent,
  });
  rememberThisDevice(device.id);
  return device;
}

async function unsubscribeThisBrowser(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
}

export function useDevices() {
  return useQuery({
    queryKey: pushKeys.devices(),
    queryFn: () => apiClient.get<PushDevice[]>('/push/subscriptions'),
  });
}

export function useSubscribeThisDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: subscribeThisDevice,
    onSuccess: (device) => {
      queryClient.setQueryData<PushDevice[]>(pushKeys.devices(), (devices = []) => [
        device,
        ...devices.filter((d) => d.id !== device.id),
      ]);
      void queryClient.invalidateQueries({ queryKey: pushKeys.devices() });
    },
  });
}

export function useRemoveDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/push/subscriptions/${id}`);
      if (id === thisDeviceId()) {
        rememberThisDevice(null);
        // Removing this browser also drops its push subscription, so "Enable" shows again.
        await unsubscribeThisBrowser().catch(() => undefined);
      }
    },
    onSuccess: (_data, id) => {
      queryClient.setQueryData<PushDevice[]>(pushKeys.devices(), (devices = []) =>
        devices.filter((d) => d.id !== id),
      );
    },
  });
}

/** Dev-only `POST /push/test` (the route doesn't exist in production). */
export function useSendTestPush() {
  return useMutation({ mutationFn: () => apiClient.post('/push/test') });
}
