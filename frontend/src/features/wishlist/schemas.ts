import { z } from 'zod';

import type { ItemPayload, Priority, WishlistItem } from './api';

/** Mirrors `app/schemas/wishlists.py` (PRD FR-WSH-2). Messages are i18n keys. */
export const ITEM_LIMITS = {
  titleMax: 120,
  noteMax: 1000,
  urlMax: 2048,
  priceMax: 2_000_000_000,
} as const;

export const itemFormErrors = {
  titleRequired: 'wishlist.form.errors.titleRequired',
  titleLength: 'wishlist.form.errors.titleLength',
  noteLength: 'wishlist.form.errors.noteLength',
  urlInvalid: 'wishlist.form.errors.urlInvalid',
  priceInteger: 'wishlist.form.errors.priceInteger',
  priceMax: 'wishlist.form.errors.priceMax',
} as const;

const E = itemFormErrors;

export interface ItemFormValues {
  title: string;
  note: string;
  url: string;
  price: string;
  priority: Priority;
}

export const emptyItemForm: ItemFormValues = {
  title: '',
  note: '',
  url: '',
  price: '',
  priority: 'medium',
};

/** http(s) with a host, nothing else (no `javascript:`, `data:`…), no spaces. */
export function isStoreLink(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 32 || code === 127) return false; // spaces and control characters
  }
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

export const itemSchema = z.object({
  title: z.string().trim().min(1, E.titleRequired).max(ITEM_LIMITS.titleMax, E.titleLength),
  note: z.string().trim().max(ITEM_LIMITS.noteMax, E.noteLength),
  url: z
    .string()
    .trim()
    .max(ITEM_LIMITS.urlMax, E.urlInvalid)
    .refine((v) => v === '' || isStoreLink(v), E.urlInvalid),
  price: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d+$/.test(v), E.priceInteger)
    .refine((v) => !/^\d+$/.test(v) || Number(v) <= ITEM_LIMITS.priceMax, E.priceMax),
  priority: z.enum(['low', 'medium', 'high']),
});

export type ItemFormOutput = z.output<typeof itemSchema>;

export function toItemPayload(values: ItemFormOutput): ItemPayload {
  return {
    title: values.title,
    note: values.note || null,
    url: values.url || null,
    price_crc: values.price === '' ? null : Number(values.price),
    priority: values.priority,
  };
}

export function itemToFormValues(item: WishlistItem): ItemFormValues {
  return {
    title: item.title,
    note: item.note ?? '',
    url: item.url ?? '',
    price: item.price_crc === null ? '' : String(item.price_crc),
    priority: item.priority,
  };
}

/** Backend field → form field, for server validation errors. */
export const itemServerFieldMap: Record<string, keyof ItemFormValues> = {
  title: 'title',
  note: 'note',
  url: 'url',
  price_crc: 'price',
  priority: 'priority',
};
