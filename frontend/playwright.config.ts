import { defineConfig, devices } from '@playwright/test';

import type { AppLocale } from './e2e/fixtures';

/**
 * End-to-end suite (CLAUDE.md §9): the happy path in both locales at mobile and desktop.
 *
 * By default this starts its own servers, isolated from development:
 *   - the API with ENV=test on :8001 (`tests.e2e_server`: database `santa_e2e`, rebuilt
 *     on each start; Redis DB 14; MinIO bucket `secret-santa-e2e`)
 *   - a production build of the app, served by `vite preview` on :4174, proxying to it
 * Postgres, Redis and MinIO must be running (the dev compose stack).
 *
 * To use servers you already started, set E2E_BASE_URL (e.g. http://localhost:4174); then
 * nothing is started and that app must proxy to an API running with ENV=test.
 */

const API_PORT = Number(process.env.E2E_API_PORT ?? 8001);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 4174);
const external = process.env.E2E_BASE_URL;
const baseURL = external ?? `http://localhost:${String(WEB_PORT)}`;

const viewports = {
  mobile: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
  desktop: { viewport: { width: 1280, height: 800 } },
} as const;

const locales: AppLocale[] = ['es', 'en'];

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The app's service worker would sit between the page and the network responses the
    // anonymity check reads; the suite exercises the network directly.
    serviceWorkers: 'block',
    browserName: 'chromium',
  },
  projects: locales.flatMap((appLocale) =>
    (Object.keys(viewports) as (keyof typeof viewports)[]).map((size) => ({
      name: `${appLocale}-${size}`,
      use: { ...viewports[size], browserName: 'chromium' as const, appLocale },
    })),
  ),
  webServer: external
    ? undefined
    : [
        {
          command: 'uv run python -m tests.e2e_server',
          cwd: '../backend',
          // 127.0.0.1, not localhost: on Windows localhost resolves to ::1 first.
          url: `http://127.0.0.1:${String(API_PORT)}/api/v1/health`,
          env: {
            ENV: 'test',
            LOG_LEVEL: 'WARNING',
            E2E_API_PORT: String(API_PORT),
            APP_BASE_URL: baseURL,
          },
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          stdout: 'pipe',
        },
        {
          command: `pnpm exec vite build && pnpm exec vite preview --port ${String(WEB_PORT)} --strictPort`,
          url: baseURL,
          env: { API_TARGET: `http://127.0.0.1:${String(API_PORT)}` },
          reuseExistingServer: !process.env.CI,
          timeout: 240_000,
        },
      ],
});
