import { describe, expect, it } from 'vitest';

import {
  emptyItemForm,
  isStoreLink,
  itemFormErrors as E,
  itemSchema,
  toItemPayload,
} from './schemas';

const parse = (values: Partial<typeof emptyItemForm>) =>
  itemSchema.safeParse({ ...emptyItemForm, title: 'Libro', ...values });

const errorsOf = (values: Partial<typeof emptyItemForm>) => {
  const result = parse(values);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe('item form schema (mirrors app/schemas/wishlists.py)', () => {
  it('needs a title of 1–120 characters (trimmed)', () => {
    expect(errorsOf({ title: '   ' })).toEqual([E.titleRequired]);
    expect(errorsOf({ title: 'x'.repeat(121) })).toEqual([E.titleLength]);
    expect(errorsOf({ title: 'x'.repeat(120) })).toEqual([]);
  });

  it('limits the note to 1000 characters', () => {
    expect(errorsOf({ note: 'n'.repeat(1001) })).toEqual([E.noteLength]);
    expect(errorsOf({ note: 'n'.repeat(1000) })).toEqual([]);
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<b>x</b>',
    'file:///etc/passwd',
    'ftp://example.com',
    'https://',
    '//example.com',
    'example.com',
    'https://exa mple.com',
  ])('refuses the store link %s', (url) => {
    expect(isStoreLink(url)).toBe(false);
    expect(errorsOf({ url })).toEqual([E.urlInvalid]);
  });

  it.each(['https://tienda.example/a?b=c', 'http://localhost:8080/x', 'HTTPS://Example.com'])(
    'accepts %s',
    (url) => {
      expect(errorsOf({ url })).toEqual([]);
    },
  );

  it('takes a whole, non-negative price or nothing', () => {
    expect(errorsOf({ price: '1.5' })).toEqual([E.priceInteger]);
    expect(errorsOf({ price: '-1' })).toEqual([E.priceInteger]);
    expect(errorsOf({ price: '₡100' })).toEqual([E.priceInteger]);
    expect(errorsOf({ price: '2000000001' })).toEqual([E.priceMax]);
    expect(errorsOf({ price: '' })).toEqual([]);
    expect(errorsOf({ price: '0' })).toEqual([]);
  });

  it('maps to the API payload with nulls for blanks', () => {
    const result = parse({ title: ' Taza ', note: ' ', price: '', url: '', priority: 'low' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(toItemPayload(result.data)).toEqual({
      title: 'Taza',
      note: null,
      url: null,
      price_crc: null,
      priority: 'low',
    });
    const priced = parse({ price: '30000', url: 'https://x.com' });
    expect(priced.success && toItemPayload(priced.data)).toMatchObject({
      price_crc: 30000,
      url: 'https://x.com',
    });
  });
});
