import { describe, expect, it } from 'vitest';

import { formatCRC, formatDate, formatDateTime, toIntlLocale } from './format';

// es-CR groups with a no-break space (U+00A0).
const NBSP = ' ';

describe('formatCRC', () => {
  it('formats ₡25 000', () => {
    expect(formatCRC(25000)).toBe(`₡25${NBSP}000`);
  });

  it.each([
    [0, '₡0'],
    [1000, `₡1${NBSP}000`],
    [1250000, `₡1${NBSP}250${NBSP}000`],
    [999.6, `₡1${NBSP}000`], // never shows decimals
  ])('%d → %s', (amount, expected) => {
    expect(formatCRC(amount)).toBe(expected);
  });
});

describe('dates', () => {
  // 15:00 UTC = 09:00 in Costa Rica (UTC−6, no DST).
  const date = new Date('2026-12-20T15:00:00Z');
  const tz = { timeZone: 'America/Costa_Rica' } as const;

  it('maps app languages to Intl locales', () => {
    expect(toIntlLocale('es')).toBe('es-CR');
    expect(toIntlLocale('en')).toBe('en');
  });

  it('formatDate in Spanish and English', () => {
    expect(formatDate(date, 'es', { dateStyle: 'medium', ...tz })).toBe('20 dic 2026');
    expect(formatDate(date, 'en', { dateStyle: 'medium', ...tz })).toBe('Dec 20, 2026');
  });

  it('formatDateTime in Spanish and English', () => {
    const opts = { dateStyle: 'medium', timeStyle: 'short', ...tz } as const;
    // es-CR uses a 12-hour clock ("a. m."); ICU may use regular or narrow spaces.
    expect(formatDateTime(date, 'es', opts)).toMatch(/^20 dic 2026, 9:00\sa\.\sm\.$/);
    expect(formatDateTime(date, 'en', opts)).toMatch(/^Dec 20, 2026, 9:00\s?AM$/);
  });

  it('accepts ISO strings and timestamps', () => {
    const iso = formatDate('2026-12-20T15:00:00Z', 'en', { dateStyle: 'medium', ...tz });
    const ms = formatDate(date.getTime(), 'en', { dateStyle: 'medium', ...tz });
    expect(iso).toBe('Dec 20, 2026');
    expect(ms).toBe('Dec 20, 2026');
  });

  it('defaults to the browser time zone', () => {
    const local = new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium' }).format(date);
    expect(formatDate(date, 'es')).toBe(local);
  });
});
