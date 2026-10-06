import { describe, expect, it } from 'vitest';

import { NAME_MAX, nameSchema } from './schemas';

const parse = (name: string) => nameSchema.safeParse({ name });
const error = (name: string) => parse(name).error?.issues[0]?.message;

describe('nameSchema', () => {
  it.each([
    ['Noah', 'Noah'],
    ['  Noah   Mata  ', 'Noah Mata'],
    ['José Ñandú', 'José Ñandú'],
    ['Noah 👶', 'Noah 👶'],
    ['The Elf', 'The Elf'],
    ['x'.repeat(NAME_MAX), 'x'.repeat(NAME_MAX)],
  ])('accepts %j as %j', (input, output) => {
    expect(parse(input).data).toEqual({ name: output });
  });

  it.each([
    ['', 'profile.name.errors.required'],
    ['   ', 'profile.name.errors.required'],
    ['x'.repeat(NAME_MAX + 1), 'profile.name.errors.length'],
    ['No\u200bah', 'profile.name.errors.invalid'],
    ['Noah\u0000', 'profile.name.errors.invalid'],
    ['Secret Elf #3', 'profile.name.errors.reserved'],
    ['Élfo  secreto', 'profile.name.errors.reserved'],
    ['deleted USER', 'profile.name.errors.reserved'],
    ['Ex participante', 'profile.name.errors.reserved'],
  ])('rejects %j', (input, message) => {
    expect(error(input)).toBe(message);
  });
});
