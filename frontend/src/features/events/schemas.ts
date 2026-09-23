import { z } from 'zod';

import { parseLocalInput, toIsoWithOffset, toLocalInputValue } from '@/lib/datetime';

import type { EventCreatePayload, EventDetail, EventState, EventUpdatePayload } from './api';

/**
 * Mirrors the backend limits exactly (`app/schemas/events.py`, PRD FR-EVT-1). Messages are
 * i18n keys, translated where the error is shown.
 */
export const EVENT_LIMITS = {
  nameMin: 3,
  nameMax: 80,
  descriptionMax: 1000,
  locationMax: 200,
  budgetMax: 2_000_000_000,
} as const;

export const eventFormErrors = {
  nameLength: 'events.form.errors.nameLength',
  descriptionLength: 'events.form.errors.descriptionLength',
  budgetRequired: 'events.form.errors.budgetRequired',
  budgetInteger: 'events.form.errors.budgetInteger',
  budgetMax: 'events.form.errors.budgetMax',
  exchangeRequired: 'events.form.errors.exchangeRequired',
  dateInvalid: 'events.form.errors.dateInvalid',
  exchangeFuture: 'events.form.errors.exchangeFuture',
  deadlineBeforeExchange: 'events.form.errors.deadlineBeforeExchange',
  locationLength: 'events.form.errors.locationLength',
} as const;

const E = eventFormErrors;

/** What the inputs hold (strings from text/date inputs, booleans from switches). */
export interface EventFormValues {
  name: string;
  description: string;
  budget: string;
  exchangeAt: string;
  joinDeadline: string;
  location: string;
  isOnline: boolean;
  groupChatEnabled: boolean;
}

export const emptyEventForm: EventFormValues = {
  name: '',
  description: '',
  budget: '',
  exchangeAt: '',
  joinDeadline: '',
  location: '',
  isOnline: false,
  groupChatEnabled: true,
};

export interface EventSchemaOptions {
  /** Edit form: the saved exchange date. Left as is, it may already be in the past. */
  originalExchangeAt?: string;
}

/** `now` is injectable so "must be in the future" is testable. */
export function createEventSchema(
  now: () => Date = () => new Date(),
  { originalExchangeAt }: EventSchemaOptions = {},
) {
  return z
    .object({
      name: z
        .string()
        .trim()
        .min(EVENT_LIMITS.nameMin, E.nameLength)
        .max(EVENT_LIMITS.nameMax, E.nameLength),
      description: z.string().trim().max(EVENT_LIMITS.descriptionMax, E.descriptionLength),
      budget: z
        .string()
        .trim()
        .min(1, E.budgetRequired)
        .regex(/^\d+$/, E.budgetInteger)
        .refine((v) => Number(v) <= EVENT_LIMITS.budgetMax, E.budgetMax),
      exchangeAt: z
        .string()
        .min(1, E.exchangeRequired)
        .refine((v) => parseLocalInput(v) !== null, E.dateInvalid)
        .refine(
          (v) => v === originalExchangeAt || (parseLocalInput(v)?.getTime() ?? 0) > now().getTime(),
          E.exchangeFuture,
        ),
      joinDeadline: z
        .string()
        .refine((v) => v === '' || parseLocalInput(v) !== null, E.dateInvalid),
      location: z.string().trim(),
      isOnline: z.boolean(),
      groupChatEnabled: z.boolean(),
    })
    .superRefine((values, ctx) => {
      // A disabled (online) location is ignored, so it can't block the form.
      if (!values.isOnline && values.location.length > EVENT_LIMITS.locationMax) {
        ctx.addIssue({ code: 'custom', path: ['location'], message: E.locationLength });
      }
      const exchange = parseLocalInput(values.exchangeAt);
      const deadline = values.joinDeadline ? parseLocalInput(values.joinDeadline) : null;
      if (exchange && deadline && deadline.getTime() >= exchange.getTime()) {
        ctx.addIssue({ code: 'custom', path: ['joinDeadline'], message: E.deadlineBeforeExchange });
      }
    });
}

export type EventFormOutput = z.output<ReturnType<typeof createEventSchema>>;

function requireDate(value: string): Date {
  const date = parseLocalInput(value);
  if (!date) throw new Error('validated date expected');
  return date;
}

/** Validated form values → `POST /events` body. An online event never sends a location. */
export function toCreatePayload(values: EventFormOutput): EventCreatePayload {
  return {
    name: values.name,
    description: values.description || null,
    budget_crc: Number(values.budget),
    exchange_at: toIsoWithOffset(requireDate(values.exchangeAt)),
    join_deadline: values.joinDeadline ? toIsoWithOffset(requireDate(values.joinDeadline)) : null,
    location: values.isOnline ? null : values.location || null,
    is_online: values.isOnline,
    group_chat_enabled: values.groupChatEnabled,
  };
}

/** Backend field name → form field, for mapping server validation errors inline. */
export const serverFieldMap: Record<string, keyof EventFormValues> = {
  name: 'name',
  description: 'description',
  budget_crc: 'budget',
  exchange_at: 'exchangeAt',
  join_deadline: 'joinDeadline',
  location: 'location',
  is_online: 'isOnline',
  group_chat_enabled: 'groupChatEnabled',
};

/** PRD §3: after the draw only these can change (mirrors the backend's DRAWN_EDITABLE). */
const DRAWN_EDITABLE = new Set<keyof EventFormValues>([
  'description',
  'location',
  'isOnline',
  'exchangeAt',
]);

/** Form fields that are read-only in `state` (everything once archived). */
export function lockedFields(state: EventState): ReadonlySet<keyof EventFormValues> {
  const all = Object.keys(emptyEventForm) as (keyof EventFormValues)[];
  if (state === 'open') return new Set();
  if (state === 'drawn') return new Set(all.filter((field) => !DRAWN_EDITABLE.has(field)));
  return new Set(all);
}

/** A saved event → the edit form's starting values (dates in the browser time zone). */
export function eventToFormValues(event: EventDetail): EventFormValues {
  const local = (iso: string | null) => (iso ? toLocalInputValue(new Date(iso)) : '');
  return {
    name: event.name,
    description: event.description ?? '',
    budget: String(event.budget_crc),
    exchangeAt: local(event.exchange_at),
    joinDeadline: local(event.join_deadline),
    location: event.location ?? '',
    isOnline: event.is_online,
    groupChatEnabled: event.group_chat_enabled,
  };
}

/** Same minute? The inputs have minute precision, so seconds must not count as a change. */
function sameMinute(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.floor(Date.parse(a) / 60_000) === Math.floor(Date.parse(b) / 60_000);
}

/** Only what actually changed, so a DRAWN event never sends a locked field. */
export function toUpdatePayload(values: EventFormOutput, event: EventDetail): EventUpdatePayload {
  const next = toCreatePayload(values);
  const patch: EventUpdatePayload = {};
  if (next.name !== event.name) patch.name = next.name;
  if (next.description !== event.description) patch.description = next.description;
  if (next.budget_crc !== event.budget_crc) patch.budget_crc = next.budget_crc;
  if (!sameMinute(next.exchange_at, event.exchange_at)) patch.exchange_at = next.exchange_at;
  if (!sameMinute(next.join_deadline, event.join_deadline)) {
    patch.join_deadline = next.join_deadline;
  }
  if (next.location !== event.location) patch.location = next.location;
  if (next.is_online !== event.is_online) patch.is_online = next.is_online;
  if (next.group_chat_enabled !== event.group_chat_enabled) {
    patch.group_chat_enabled = next.group_chat_enabled;
  }
  return patch;
}
