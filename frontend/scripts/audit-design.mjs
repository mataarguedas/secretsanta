#!/usr/bin/env node
// Design-rule and i18n audit (CLAUDE.md §6.2, §8, §12). `pnpm audit:design`; CI runs it.
// Parses every app source file with the TypeScript compiler and reports:
//   - shadow-* classes, font-bold/semibold/black, raw hex colors (also ESLint rules)
//   - a raw <button> outside src/components/ui (features compose the primitives)
//   - user-facing string literals in JSX: text children, and aria-label / title /
//     placeholder / alt / label attributes (everything must go through t())
//   - translation keys used in code (t('…'), <Trans i18nKey>, 'ns.key' strings) that are
//     missing from es.json or en.json, and keys whose sets differ between the two files
// Exits 1 when anything is found.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const SKIP_DIRS = new Set(['test', 'dev']); // test helpers; the dev-only UI showcase
const UI_DIR = join(SRC, 'components', 'ui') + sep;
const TEXT_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt', 'label']);

const load = (lng) => JSON.parse(readFileSync(join(SRC, 'i18n', `${lng}.json`), 'utf8'));
const dictionaries = { es: load('es'), en: load('en') };
const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
const keySets = Object.fromEntries(
  Object.entries(dictionaries).map(([lng, d]) => [lng, new Set(flatten(d))]),
);
const namespaces = new Set(Object.keys(dictionaries.es));
const PLURALS = ['_zero', '_one', '_two', '_few', '_many', '_other'];

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : files(path);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$|\.d\.ts$/.test(entry.name)) return [];
    return [path];
  });
}

const findings = [];
let dynamicKeys = 0;
let keysChecked = 0;

function report(file, node, source, rule, detail) {
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  findings.push(`${relative(ROOT, file)}:${String(line + 1)}  [${rule}]  ${detail}`);
}

function keyExists(lng, key) {
  const set = keySets[lng];
  return set.has(key) || PLURALS.some((suffix) => set.has(key + suffix));
}

function checkKey(file, node, source, key) {
  keysChecked += 1;
  for (const lng of ['es', 'en']) {
    if (!keyExists(lng, key)) report(file, node, source, 'missing-key', `${key} (${lng}.json)`);
  }
}

const looksLikeKey = (text) => {
  const match = /^([a-zA-Z]+)(\.[A-Za-z0-9_]+)+$/.exec(text);
  return match !== null && namespaces.has(match[1]);
};
// Words, not bare URL hints like placeholder="https://".
const hasWords = (text) => /\p{L}{2,}/u.test(text) && !/^https?:\/\/\S*$/.test(text.trim());

function classStrings(node) {
  // String literals and template chunks anywhere (className, cn(), cva maps, …).
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
  }
  return [];
}

function audit(file) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const inUi = file.startsWith(UI_DIR);
  const inStyles = file.includes(`${sep}styles${sep}`);

  const visit = (node) => {
    for (const chunk of classStrings(node)) {
      if (/(^|[\s:])shadow-/.test(chunk)) report(file, node, source, 'no-shadow', chunk.trim());
      if (/(^|[\s:])font-(bold|semibold|extrabold|black)\b/.test(chunk)) {
        report(file, node, source, 'no-bold', chunk.trim());
      }
      if (!inStyles && /#[0-9a-fA-F]{3,8}\b/.test(chunk) && !looksLikeKey(chunk)) {
        // Allow fragment links and ids like "#main"; flag color-shaped hex only.
        if (/(^|[^\w&])#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/.test(chunk)) {
          report(file, node, source, 'no-hex', chunk.trim());
        }
      }
      if (looksLikeKey(chunk)) checkKey(file, node, source, chunk);
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (tag === 'button' && !inUi) {
        report(file, node, source, 'raw-button', 'use <Button>/<Pill> from components/ui');
      }
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || !attr.initializer) continue;
        const name = attr.name.getText(source);
        if (TEXT_ATTRS.has(name) && ts.isStringLiteral(attr.initializer)) {
          if (hasWords(attr.initializer.text)) {
            report(file, attr, source, 'jsx-literal', `${name}="${attr.initializer.text}"`);
          }
        }
        if (name === 'i18nKey' && ts.isStringLiteral(attr.initializer)) {
          checkKey(file, attr, source, attr.initializer.text);
        }
      }
    }

    if (ts.isJsxText(node) && hasWords(node.getText(source))) {
      report(file, node, source, 'jsx-literal', JSON.stringify(node.getText(source).trim()));
    }

    if (
      ts.isCallExpression(node) &&
      (node.expression.getText(source) === 't' || node.expression.getText(source).endsWith('.t'))
    ) {
      const [first] = node.arguments;
      // Any literal key, even outside a known namespace (those are caught above).
      if (first && ts.isStringLiteralLike(first)) {
        if (!looksLikeKey(first.text)) checkKey(file, first, source, first.text);
      } else if (first) dynamicKeys += 1;
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
}

const sources = files(SRC);
for (const file of sources) audit(file);

for (const [a, b] of [
  ['es', 'en'],
  ['en', 'es'],
]) {
  for (const key of keySets[a]) {
    if (!keySets[b].has(key))
      findings.push(`src/i18n/${b}.json  [missing-key]  ${key} (in ${a}.json only)`);
  }
}

console.log(
  `audit-design: ${String(sources.length)} files, ${String(keysChecked)} static translation keys checked, ` +
    `${String(dynamicKeys)} dynamic t() calls (not checkable statically)`,
);
if (findings.length > 0) {
  console.log(`\n${String(findings.length)} finding(s):\n${findings.join('\n')}`);
  process.exit(1);
}
console.log('No findings: no shadows, bold, raw hex, raw <button>, JSX literals or missing keys.');
