// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

function themeBlocks(css: string): string[] {
  return [...css.matchAll(/@theme \{[\s\S]*?\n\}/g)].map((m) => m[0]);
}

describe('src/styles/tokens.css', () => {
  const design = read('../../DESIGN.md');
  const tokens = read('../src/styles/tokens.css');

  it('contains the DESIGN.md Tailwind v4 @theme block verbatim', () => {
    const [fromDesign] = themeBlocks(design);
    expect(fromDesign).toBeDefined();
    expect(themeBlocks(tokens)[0]).toBe(fromDesign);
  });

  it('adds the CLAUDE.md §6.1 feedback colors and font substitutes', () => {
    const additions = themeBlocks(tokens)[1] ?? '';
    expect(additions).toContain('--color-success: #2E7D4F;');
    expect(additions).toContain('--color-error:   #C62828;');
    expect(additions).toContain("--font-serif: 'Playfair Display', Georgia, serif;");
    expect(additions).toContain("--font-sans:  'Inter', ui-sans-serif, system-ui, sans-serif;");
    expect(additions).toContain("--font-mono:  'JetBrains Mono', ui-monospace, monospace;");
  });
});

describe('src/styles/fonts.css', () => {
  const fonts = read('../src/styles/fonts.css');

  it('self-hosts every face with font-display: swap and no remote URLs', () => {
    const faces = fonts.match(/@font-face \{[\s\S]*?\}/g) ?? [];
    expect(faces).toHaveLength(8); // 4 faces × (latin, latin-ext)
    for (const face of faces) {
      expect(face).toContain('font-display: swap;');
      expect(face).toMatch(/src: url\('\/fonts\/[a-z0-9-]+\.woff2'\) format\('woff2'\);/);
    }
    expect(fonts).not.toMatch(/googleapis|gstatic|https?:/);
  });

  it('references files that exist in public/fonts', () => {
    for (const [, file] of fonts.matchAll(/url\('\/fonts\/([^']+)'\)/g)) {
      expect(() => read(`../public/fonts/${file ?? ''}`)).not.toThrow();
    }
  });
});
