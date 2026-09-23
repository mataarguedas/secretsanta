import { describe, expect, it } from 'vitest';

import { parseLocalInput, toIsoWithOffset, toLocalInputValue } from './datetime';

describe('datetime-local helpers', () => {
  it('parses wall-clock input in the browser time zone', () => {
    const date = parseLocalInput('2026-12-20T19:00');
    expect(date).toEqual(new Date(2026, 11, 20, 19, 0));
  });

  it.each(['', '2026-12-20', '2026-02-30T10:00', '2026-13-01T10:00', 'tomorrow'])(
    'rejects %j',
    (value) => {
      expect(parseLocalInput(value)).toBeNull();
    },
  );

  it('serializes with an explicit offset that round-trips to the same instant', () => {
    const date = new Date(2026, 11, 20, 19, 0);
    const iso = toIsoWithOffset(date);
    expect(iso).toMatch(/^2026-12-20T19:00:00[+-]\d{2}:\d{2}$/);
    expect(new Date(iso).getTime()).toBe(date.getTime());
  });

  it('formats a Date back into an input value', () => {
    expect(toLocalInputValue(new Date(2026, 0, 5, 9, 7))).toBe('2026-01-05T09:07');
  });
});
