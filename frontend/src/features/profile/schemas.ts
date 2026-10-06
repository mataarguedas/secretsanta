import { z } from 'zod';

/** Mirrors `app/schemas/me.py` (`DisplayName`). Messages are i18n keys. */
export const NAME_MAX = 60;

export const nameFormErrors = {
  required: 'profile.name.errors.required',
  length: 'profile.name.errors.length',
  invalid: 'profile.name.errors.invalid',
  reserved: 'profile.name.errors.reserved',
  server: 'profile.name.errors.server',
} as const;

const E = nameFormErrors;

// Control and invisible formatting characters (Unicode Cc / Cf), as the backend rejects them.
const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}]/u;
// Would pass a named person off as an anonymous "Secret Elf" or a deleted/former member.
const RESERVED_PARTS = ['secret elf', 'elfo secreto'];
const RESERVED_NAMES = [
  'deleted user',
  'usuario eliminado',
  'former participant',
  'ex participante',
];

function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

export function isReservedName(value: string): boolean {
  const folded = fold(value);
  return RESERVED_NAMES.includes(folded) || RESERVED_PARTS.some((part) => folded.includes(part));
}

export const nameSchema = z.object({
  name: z
    .string()
    .refine((value) => !HIDDEN_CHARACTERS.test(value), E.invalid)
    .transform((value) => value.replace(/\s+/g, ' ').trim())
    .pipe(
      z
        .string()
        .min(1, E.required)
        .max(NAME_MAX, E.length)
        .refine((value) => !isReservedName(value), E.reserved),
    ),
});

export type NameFormValues = z.input<typeof nameSchema>;
export type NameFormOutput = z.output<typeof nameSchema>;
