import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';

import i18n, { DEFAULT_LANGUAGE } from '@/i18n';

expect.extend(axeMatchers);

// jsdom reports navigator.language = 'en-US'; start every test in the product default.
beforeEach(async () => {
  await i18n.changeLanguage(DEFAULT_LANGUAGE);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals(); // e.g. the fake XMLHttpRequest from mockSession
});
