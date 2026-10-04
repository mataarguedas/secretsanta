import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  reloadWhenSafe,
  startServiceWorkerUpdates,
  UPDATE_CHECK_INTERVAL_MS,
  type RegisterSW,
} from './serviceWorkerUpdates';

let visibility: DocumentVisibilityState;
let online: boolean;

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Starts the updater with a fake registerSW; returns the registration and its hooks. */
function start() {
  const update = vi.fn(() => Promise.resolve());
  const registration = { update } as unknown as ServiceWorkerRegistration;
  const reload = vi.fn();
  let options: Parameters<RegisterSW>[0] = {};
  const registerSW: RegisterSW = (opts) => {
    options = opts;
    return undefined;
  };
  startServiceWorkerUpdates(registerSW, reload);
  options.onRegisteredSW?.('/sw.js', registration);
  return { update, reload, options };
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  online = true;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('startServiceWorkerUpdates', () => {
  it('registers the worker right away', () => {
    const { options } = start();
    expect(options.immediate).toBe(true);
  });

  it('looks for a new version whenever the app comes back to the foreground (iOS PWA resume)', () => {
    const { update } = start();
    setVisibility('hidden');
    expect(update).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('looks again when the connection returns, and hourly while on screen', () => {
    const { update } = start();
    window.dispatchEvent(new Event('online'));
    expect(update).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(2);

    visibility = 'hidden';
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("doesn't check while offline", () => {
    const { update } = start();
    online = false;
    setVisibility('visible');
    expect(update).not.toHaveBeenCalled();
  });

  it('reloads onto the new version once it has taken over', () => {
    const { reload, options } = start();
    options.onNeedReload?.();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('reloadWhenSafe', () => {
  it('reloads right away when nothing is being typed', () => {
    const reload = vi.fn();
    reloadWhenSafe(reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits for the app to go to the background while a message is being typed', () => {
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    textarea.value = 'Hola, ¿qué talla…';
    textarea.focus();
    const reload = vi.fn();

    reloadWhenSafe(reload);
    expect(reload).not.toHaveBeenCalled();

    setVisibility('hidden');
    expect(reload).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    setVisibility('hidden');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('an empty focused field is not a draft', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const reload = vi.fn();
    reloadWhenSafe(reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
