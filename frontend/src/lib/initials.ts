/** "Ana María Pérez" → "AP"; "ana" → "A". Grapheme-naive but emoji-safe for the first code point. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const picked = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return picked
    .map((w) => (w ? (Array.from(w)[0] ?? '') : ''))
    .join('')
    .toLocaleUpperCase();
}
