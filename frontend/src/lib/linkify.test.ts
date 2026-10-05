import { describe, expect, it } from 'vitest';

import { linkify } from './linkify';

const links = (text: string) =>
  linkify(text).flatMap((s) => (s.kind === 'link' ? [[s.text, s.href]] : []));

describe('linkify', () => {
  it('leaves plain text as a single text segment', () => {
    expect(linkify('Hola, ¿qué talla usás?')).toEqual([
      { kind: 'text', text: 'Hola, ¿qué talla usás?' },
    ]);
    expect(linkify('')).toEqual([]);
  });

  it('finds http(s) URLs and keeps the surrounding text', () => {
    expect(linkify('Mirá https://tienda.cr/libro?id=3#a este')).toEqual([
      { kind: 'text', text: 'Mirá ' },
      {
        kind: 'link',
        text: 'https://tienda.cr/libro?id=3#a',
        href: 'https://tienda.cr/libro?id=3#a',
      },
      { kind: 'text', text: ' este' },
    ]);
    expect(links('http://example.com')).toEqual([['http://example.com', 'http://example.com/']]);
  });

  it('links bare www. hosts over https', () => {
    expect(links('en www.amazon.com/dp/123')).toEqual([
      ['www.amazon.com/dp/123', 'https://www.amazon.com/dp/123'],
    ]);
  });

  it('finds several URLs, including across lines', () => {
    expect(links('a https://a.com\nb www.b.com c')).toEqual([
      ['https://a.com', 'https://a.com/'],
      ['www.b.com', 'https://www.b.com/'],
    ]);
  });

  it('drops trailing sentence punctuation and unbalanced closing brackets', () => {
    expect(links('¿Viste https://a.com/x?')).toEqual([['https://a.com/x', 'https://a.com/x']]);
    expect(links('Este: https://a.com.')).toEqual([['https://a.com', 'https://a.com/']]);
    expect(links('(ver https://a.com/x)')).toEqual([['https://a.com/x', 'https://a.com/x']]);
    expect(links('https://es.wikipedia.org/wiki/Lego_(juguete)')).toEqual([
      [
        'https://es.wikipedia.org/wiki/Lego_(juguete)',
        'https://es.wikipedia.org/wiki/Lego_(juguete)',
      ],
    ]);
  });

  it('never produces a non-http link', () => {
    expect(links('javascript:alert(1) data:text/html,x ftp://a.com')).toEqual([]);
    expect(links('https://javascript:alert(1)')).toEqual([]);
  });

  it('ignores a bare scheme, emails and URLs glued to words', () => {
    expect(links('https:// y www. solos')).toEqual([]);
    expect(links('ana@www.example.com')).toEqual([]);
    expect(links('xhttps://a.com')).toEqual([]);
  });
});
