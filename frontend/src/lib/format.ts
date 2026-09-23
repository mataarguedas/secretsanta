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
