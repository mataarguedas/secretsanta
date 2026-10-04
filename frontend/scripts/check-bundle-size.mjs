#!/usr/bin/env node
// PRD §10: initial JS < 250 KB gzipped. Runs after `vite build` (part of `pnpm build`).
// "Initial" = the scripts dist/index.html loads up front: module entry points, their
// modulepreloads, and any classic scripts. Lazy chunks don't count.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const LIMIT_KB = 250;
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const urls = new Set();
for (const [, src] of html.matchAll(/<script\b[^>]*\bsrc="([^"]+\.js)"/g)) urls.add(src);
for (const [, href] of html.matchAll(/<link\b[^>]*rel="modulepreload"[^>]*href="([^"]+\.js)"/g)) {
  urls.add(href);
}
if (urls.size === 0) {
  console.error('check-bundle-size: no scripts found in dist/index.html');
  process.exit(1);
}

let total = 0;
const rows = [...urls].map((url) => {
  const bytes = gzipSync(readFileSync(join(DIST, url.replace(/^\//, ''))), { level: 9 }).length;
  total += bytes;
  return `  ${(bytes / 1024).toFixed(1).padStart(7)} KB  ${url}`;
});
const totalKb = total / 1024;
console.log(
  `Initial JS (gzipped):\n${rows.join('\n')}\n  ${totalKb.toFixed(1).padStart(7)} KB  total (limit ${String(LIMIT_KB)} KB)`,
);
if (totalKb > LIMIT_KB) {
  console.error(
    `check-bundle-size: initial JS is ${totalKb.toFixed(1)} KB gzipped, over ${String(LIMIT_KB)} KB.`,
  );
  process.exit(1);
}
