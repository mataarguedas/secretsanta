import { describe, expect, it } from 'vitest';

import { toLocalInputValue } from '@/lib/datetime';

import {
  createEventSchema,
  emptyEventForm,
  eventFormErrors as E,
  toCreatePayload,
  type EventFormValues,
} from './schemas';

const NOW = new Date(2026, 8, 23, 12, 0); // 2026-09-23 12:00 local
const schema = createEventSchema(() => NOW);

const inDays = (days: number) => toLocalInputValue(new Date(NOW.getTime() + days * 86_400_000));

const valid: EventFormValues = {
  ...emptyEventForm,
  name: 'Familia',
  budget: '15000',
  exchangeAt: inDays(30),
};

/** The first message for `field`, or undefined when that field is valid. */
function errorFor(values: Partial<EventFormValues>, field: keyof EventFormValues) {
  const result = schema.safeParse({ ...valid, ...values });
  return result.success
    ? undefined
    : result.error.issues.find((issue) => issue.path[0] === field)?.message;
}

describe('event form schema (mirrors backend FR-EVT-1 limits)', () => {
  it('accepts a minimal valid event', () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['name too short', { name: 'ab' }, 'name', E.nameLength],
    ['name too short after trimming', { name: '  ab  ' }, 'name', E.nameLength],
    ['name too long', { name: 'x'.repeat(81) }, 'name', E.nameLength],
    ['description too long', { description: 'x'.repeat(1001) }, 'description', E.descriptionLength],
    ['budget empty', { budget: '' }, 'budget', E.budgetRequired],
    ['budget with decimals', { budget: '12.5' }, 'budget', E.budgetInteger],
    ['budget with letters', { budget: '12abc' }, 'budget', E.budgetInteger],
    ['budget negative', { budget: '-1' }, 'budget', E.budgetInteger],
    ['budget too large', { budget: '2000000001' }, 'budget', E.budgetMax],
    ['exchange empty', { exchangeAt: '' }, 'exchangeAt', E.exchangeRequired],
    ['exchange invalid', { exchangeAt: '2026-02-30T10:00' }, 'exchangeAt', E.dateInvalid],
    ['exchange in the past', { exchangeAt: inDays(-1) }, 'exchangeAt', E.exchangeFuture],
    ['exchange right now', { exchangeAt: toLocalInputValue(NOW) }, 'exchangeAt', E.exchangeFuture],
    [
      'deadline after exchange',
      { exchangeAt: inDays(5), joinDeadline: inDays(6) },
      'joinDeadline',
      E.deadlineBeforeExchange,
    ],
    [
      'deadline equal to exchange',
      { exchangeAt: inDays(5), joinDeadline: inDays(5) },
      'joinDeadline',
      E.deadlineBeforeExchange,
    ],
    ['deadline invalid', { joinDeadline: 'soon' }, 'joinDeadline', E.dateInvalid],
    ['location too long', { location: 'x'.repeat(201) }, 'location', E.locationLength],
  ] as const)('%s', (_case, values, field, message) => {
    expect(errorFor(values, field)).toBe(message);
  });

  it.each([
    ['name at the limits', { name: 'abc' }, 'name'],
    ['80-char name', { name: 'x'.repeat(80) }, 'name'],
    ['1000-char description', { description: 'x'.repeat(1000) }, 'description'],
    ['zero budget', { budget: '0' }, 'budget'],
    ['max budget', { budget: '2000000000' }, 'budget'],
    ['deadline before exchange', { joinDeadline: inDays(10) }, 'joinDeadline'],
    ['online ignores a long location', { isOnline: true, location: 'x'.repeat(300) }, 'location'],
  ] as const)('allows %s', (_case, values, field) => {
    expect(errorFor(values, field)).toBeUndefined();
  });
});

describe('toCreatePayload', () => {
  it('trims, converts and sends dates with an offset', () => {
    const parsed = schema.parse({
      ...valid,
      name: '  Familia  ',
      description: '  ',
      budget: '015000',
      joinDeadline: inDays(10),
      location: ' San José ',
      groupChatEnabled: false,
    });
    const payload = toCreatePayload(parsed);
    expect(payload).toMatchObject({
      name: 'Familia',
      description: null,
      budget_crc: 15000,
      location: 'San José',
      is_online: false,
      group_chat_enabled: false,
    });
    expect(payload.exchange_at).toMatch(/T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/);
    expect(new Date(payload.exchange_at).getTime()).toBe(
      new Date(NOW.getTime() + 30 * 86_400_000).getTime(),
    );
    expect(payload.join_deadline).not.toBeNull();
  });

  it('never sends a location for an online event', () => {
    const payload = toCreatePayload(
      schema.parse({ ...valid, location: 'Heredia', isOnline: true }),
    );
    expect(payload.location).toBeNull();
    expect(payload.is_online).toBe(true);
    expect(payload.join_deadline).toBeNull();
  });
});
