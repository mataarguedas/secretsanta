/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional, build time: enables frontend Sentry (src/lib/sentry.ts). */
  readonly VITE_SENTRY_DSN?: string;
}
