import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { ProxyOptions } from 'vite';
import { defineConfig } from 'vitest/config';

const API_TARGET = 'http://localhost:8000';

// Same-origin in the browser: /api and /ws are forwarded to FastAPI (CLAUDE.md §5).
const proxy: Record<string, ProxyOptions> = {
  '/api': { target: API_TARGET, changeOrigin: false },
  '/ws': { target: API_TARGET, ws: true, changeOrigin: false },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
