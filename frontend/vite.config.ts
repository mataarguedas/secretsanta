import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { ProxyOptions } from 'vite';
import { VitePWA, type ManifestOptions } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const API_TARGET = 'http://localhost:8000';

// Same-origin in the browser: /api and /ws are forwarded to FastAPI (CLAUDE.md §5).
const proxy: Record<string, ProxyOptions> = {
  '/api': { target: API_TARGET, changeOrigin: false },
  '/ws': { target: API_TARGET, ws: true, changeOrigin: false },
};

// FR-PWA-1. Colors are DESIGN.md's cream-linen (the manifest can't read CSS tokens).
const manifest: Partial<ManifestOptions> = {
  id: '/',
  name: 'Secret Santa',
  short_name: 'Secret Santa',
  lang: 'es',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  theme_color: '#fff5e6',
  background_color: '#fff5e6',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    {
      src: '/icons/icon-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
};

// Custom service worker (src/sw.ts) with a Workbox-injected precache list (CLAUDE.md §3, §8).
const pwa = VitePWA({
  strategies: 'injectManifest',
  srcDir: 'src',
  filename: 'sw.ts',
  registerType: 'autoUpdate',
  injectRegister: 'script-defer',
  manifest,
  injectManifest: {
    globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'],
  },
  // The worker also runs under `pnpm dev`, so push can be tried locally (Prompt 24 tests).
  devOptions: { enabled: true, type: 'module', navigateFallback: 'index.html' },
});

export default defineConfig({
  // Vitest doesn't need (or want) a service worker build.
  plugins: [react(), tailwindcss(), ...(process.env.VITEST ? [] : [pwa])],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: 4173, proxy },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'eslint-rules/**/*.test.ts', 'tests/**/*.test.ts'],
    css: false,
    restoreMocks: true,
  },
});
