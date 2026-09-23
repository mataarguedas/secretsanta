/**
 * `<input type="datetime-local">` speaks wall-clock time with no zone. These helpers read
 * it in the browser's time zone and send ISO 8601 *with the offset*, so the API stores the
 * exact instant the user meant (FR-I18N-3).
 */

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');

/** "2026-12-20T19:00" → Date in the browser time zone, or null if it isn't a valid value. */
export function parseLocalInput(value: string): Date | null {
  const m = LOCAL_INPUT.exec(value);
  if (!m) return null;
  const [, year, month, day, hours, minutes, seconds] = m;
  const n = (part: string | undefined) => Number(part ?? 0);
  const date = new Date(n(year), n(month) - 1, n(day), n(hours), n(minutes), n(seconds));
  // Reject rollovers such as Feb 30.
  return date.getMonth() === n(month) - 1 && date.getDate() === n(day) ? date : null;
}

/** Date → "2026-12-20T19:00:00-06:00" (local wall time plus its UTC offset). */
export function toIsoWithOffset(date: Date): string {
  const offset = -date.getTimezoneOffset(); // minutes east of UTC
  const sign = offset >= 0 ? '+' : '-';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
  );
}

/** Date → "2026-12-20T19:00", e.g. for an input's `min` or default value. */
export function toLocalInputValue(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
