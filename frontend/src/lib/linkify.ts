/**
 * Splits plain text into text and link segments so chat bodies can render URLs as anchors.
 * Only `http(s)://…` and bare `www.…` are recognized; the href is always http(s), so a body
 * can never produce a `javascript:` or `data:` link. Text is never parsed as HTML.
 */
export type LinkSegment =
  { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

// A scheme or "www." not glued to a preceding word, email or path, then everything up to
// whitespace or an angle bracket/quote.
const URL_PATTERN = /(?<![\w@./-])(?:https?:\/\/|www\.)[^\s<>"]+/gi;
// Sentence punctuation that usually ends the sentence, not the URL.
const TRAILING_PUNCTUATION = /[.,;:!?'*_~]+$/;

/** Drops trailing punctuation and closing brackets that have no opener inside the URL. */
function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const before = url;
    url = url.replace(TRAILING_PUNCTUATION, '');
    for (const [open, close] of [
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ] as const) {
      while (url.endsWith(close) && count(url, close) > count(url, open)) url = url.slice(0, -1);
    }
    if (url === before) return url;
  }
}

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

function toHref(text: string): string | null {
  const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // "https://" alone or "www." alone is not a link.
    if (!url.hostname.includes('.')) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function linkify(text: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let cursor = 0;
  const pushText = (value: string) => {
    if (!value) return;
    const last = segments.at(-1);
    if (last?.kind === 'text') last.text += value;
    else segments.push({ kind: 'text', text: value });
  };

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    const url = trimUrl(match[0]);
    const href = toHref(url);
    if (!href) continue;
    pushText(text.slice(cursor, start));
    segments.push({ kind: 'link', text: url, href });
    cursor = start + url.length;
  }
  pushText(text.slice(cursor));
  return segments;
}
