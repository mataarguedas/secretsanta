import '@testing-library/jest-dom/vitest';

import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';

import { outbox } from '@/features/chat/outbox';
import i18n, { DEFAULT_LANGUAGE } from '@/i18n';

import { FakeWebSocket } from './fakeWebSocket';

expect.extend(axeMatchers);

// findBy*/waitFor give up after 1 s by default; parallel workers on a busy machine can need
// longer for multi-request screens. A slower pass is fine, a flaky failure isn't.
configure({ asyncUtilTimeout: 3000 });

// jsdom reports navigator.language = 'en-US'; start every test in the product default.
beforeEach(async () => {
  await i18n.changeLanguage(DEFAULT_LANGUAGE);
  // The app opens its realtime socket when signed in; tests drive it by hand.
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals(); // e.g. the fake XMLHttpRequest from mockSession
  outbox.clear();
});
