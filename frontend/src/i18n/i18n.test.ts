import { afterEach, describe, expect, it, vi } from 'vitest';

import en from './en.json';
import es from './es.json';
import i18n, { DEFAULT_LANGUAGE, detectLanguage } from './index';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]: [string, unknown]) =>
    v !== null && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

function lookup(dict: object, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict);
}

describe('detectLanguage', () => {
  it.each([
    [['en-US'], 'en'],
    [['en'], 'en'],
    [['EN-gb', 'es'], 'en'],
    [['es-CR'], 'es'],
    [['es'], 'es'],
    [['fr-FR', 'en-US'], 'es'], // only the first preference counts; unsupported → es
    [['english'], 'es'],
    [[], 'es'],
  ] as const)('%j → %s', (languages, expected) => {
    expect(detectLanguage(languages)).toBe(expected);
  });

  it('reads navigator.languages by default', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US', 'es']);
    expect(detectLanguage()).toBe('en');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['es-CR']);
    expect(detectLanguage()).toBe('es');
  });
});

describe('i18n', () => {
  afterEach(async () => {
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  });

  it('defaults and falls back to Spanish', () => {
    expect(DEFAULT_LANGUAGE).toBe('es');
    expect(i18n.options.fallbackLng).toEqual(['es']);
  });

  it('keeps <html lang> in sync with the language', async () => {
    await i18n.changeLanguage('en');
    expect(document.documentElement.lang).toBe('en');
    await i18n.changeLanguage('es');
    expect(document.documentElement.lang).toBe('es');
  });

  it('es.json and en.json define exactly the same keys', () => {
    expect(keys(en).sort()).toEqual(keys(es).sort());
  });

  it('has no empty strings', () => {
    for (const [lng, dict] of [
      ['es', es],
      ['en', en],
    ] as const) {
      for (const key of keys(dict)) {
        expect(lookup(dict, key), `${lng}:${key}`).not.toBe('');
      }
    }
  });
});
