/** Locale-aware formatting (FR-I18N-3). Money is always CRC; dates use the browser time zone. */

const crcFormatter = new Intl.NumberFormat('es-CR', {
  style: 'currency',
  currency: 'CRC',
  minimumFractionDigits: 0, // explicit for older Safari, which otherwise keeps CRC's 2 digits
  maximumFractionDigits: 0,
});

/** Integer colones → "₡25 000" (es-CR grouping, the same in every UI language). */
export function formatCRC(amount: number): string {
  return crcFormatter.format(amount);
}

/** App language → Intl locale. Spanish is Costa Rican Spanish. */
export function toIntlLocale(locale: string): string {
  return locale === 'es' ? 'es-CR' : locale;
}

export type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatDate(
  value: DateInput,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  return new Intl.DateTimeFormat(toIntlLocale(locale), options).format(toDate(value));
}

export function formatDateTime(
  value: DateInput,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  return new Intl.DateTimeFormat(toIntlLocale(locale), options).format(toDate(value));
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['minute', 60],
  ['hour', 60 * 60],
  ['day', 24 * 60 * 60],
];

/**
 * "hace 5 min", "ayer"… for the last week; a short date before that. Under a minute is
 * `justNow` (translated by the caller).
 */
export function formatRelative(
  value: DateInput,
  locale: string,
  now: Date = new Date(),
): string | null {
  const seconds = Math.round((toDate(value).getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return null;
  if (abs >= 7 * 24 * 60 * 60) return formatDate(value, locale, { dateStyle: 'short' });
  const rtf = new Intl.RelativeTimeFormat(toIntlLocale(locale), {
    numeric: 'auto',
    style: 'short',
  });
  const [unit, size] = [...UNITS].reverse().find(([, s]) => abs >= s) ?? ['minute', 60];
  return rtf.format(Math.round(seconds / size), unit);
}
