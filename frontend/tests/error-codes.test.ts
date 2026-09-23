// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Codes in backend/app/core/errors.py ERROR_REGISTRY. */
function backendCodes(): string[] {
  const source = read('../../backend/app/core/errors.py');
  const registry = /ERROR_REGISTRY[^{]*\{([\s\S]*?)\n\}/.exec(source)?.[1] ?? '';
  return [...registry.matchAll(/^\s*"([A-Z][A-Z0-9_]+)":/gm)].map((m) => m[1] ?? '');
}

const CLIENT_CODES = ['NETWORK_ERROR', 'UNKNOWN_ERROR', 'UNAUTHENTICATED'];

describe('error code translations (PROMPTS.md rule 5)', () => {
  const codes = [...backendCodes(), ...CLIENT_CODES];

  it('finds the backend registry', () => {
    expect(backendCodes()).toContain('VALIDATION_ERROR');
  });

  it.each(['es', 'en'])('%s.json has errors.<CODE> for every backend and client code', (lng) => {
    const dict = JSON.parse(read(`../src/i18n/${lng}.json`)) as {
      errors?: Record<string, string>;
    };
    for (const code of codes) {
      expect(dict.errors?.[code], `${lng}: errors.${code}`).toBeTruthy();
    }
  });
});
