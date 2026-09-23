// @ts-check
/**
 * Local ESLint plugin that enforces the DESIGN.md / CLAUDE.md §6 class rules:
 *
 *   - no-shadow-classes:     no `shadow-*`, `drop-shadow-*`, `inset-shadow-*`,
 *                            `text-shadow-*` or `[box-shadow:…]` classes. Ever.
 *   - no-heavy-font-weight:  no `font-bold` / `font-semibold` / `font-extrabold` /
 *                            `font-black`; `font-medium` only together with `font-serif`.
 *   - no-raw-hex-colors:     no hex literals (`bg-[#fa7864]`) — use the tokens.
 *
 * Classes are collected from JSX `className` / `class` attributes and from calls to
 * class-name helpers (`cn`, `clsx`, `cva`, `twMerge`, `classNames`), including strings
 * nested in conditionals, logical expressions, template literals, arrays and objects.
 */

/** @typedef {import('eslint').Rule.RuleModule} RuleModule */
/** @typedef {import('eslint').Rule.RuleContext} RuleContext */
/** @typedef {import('eslint').Rule.Node} Node */

const CLASS_ATTRIBUTES = new Set(['className', 'class']);
const CLASS_HELPERS = new Set(['cn', 'clsx', 'cva', 'twMerge', 'classNames']);

const SHADOW_RE =
  /^(?:shadow|drop-shadow|inset-shadow|text-shadow)(?:-|\/|$)|^\[(?:box|text)-shadow:/;
const HEAVY_WEIGHT_RE = /^font-(?:bold|semibold|extrabold|black)$/;
const MEDIUM_WEIGHT = 'font-medium';
const SERIF = 'font-serif';
const HEX_RE = /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z])/;

/**
 * Strip variant prefixes (`md:`, `hover:`, `[&>p]:`), the important modifier and a
 * leading negative sign, so `md:hover:!shadow-lg` → `shadow-lg`. Colons inside
 * brackets (arbitrary values/properties) are not variant separators.
 * @param {string} token
 * @returns {string}
 */
export function baseUtility(token) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ':' && depth === 0) start = i + 1;
  }
  let base = token.slice(start);
  if (base.startsWith('!')) base = base.slice(1);
  if (base.endsWith('!')) base = base.slice(0, -1);
  if (base.startsWith('-')) base = base.slice(1);
  return base;
}

/**
 * Collect every string fragment (with its AST node) reachable from an expression that
 * can end up in a class list.
 * @param {any} node
 * @param {{ node: Node, value: string }[]} out
 */
function collectStrings(node, out) {
  if (!node) return;
  switch (node.type) {
    case 'Literal':
      if (typeof node.value === 'string') out.push({ node, value: node.value });
      break;
    case 'TemplateLiteral':
      for (const quasi of node.quasis) out.push({ node: quasi, value: quasi.value.cooked ?? '' });
      for (const expr of node.expressions) collectStrings(expr, out);
      break;
    case 'TaggedTemplateExpression':
      collectStrings(node.quasi, out);
      break;
    case 'JSXExpressionContainer':
      collectStrings(node.expression, out);
      break;
    case 'ConditionalExpression':
      collectStrings(node.consequent, out);
      collectStrings(node.alternate, out);
      break;
    case 'LogicalExpression':
    case 'BinaryExpression':
      collectStrings(node.left, out);
      collectStrings(node.right, out);
      break;
    case 'ArrayExpression':
      for (const el of node.elements) collectStrings(el, out);
      break;
    case 'ObjectExpression':
      for (const prop of node.properties) {
        if (prop.type !== 'Property') continue;
        // clsx({ 'shadow-md': cond }) → the key is the class; cva({ variants: {…} }) → values.
        if (prop.key.type === 'Literal' && !prop.computed) collectStrings(prop.key, out);
        collectStrings(prop.value, out);
      }
      break;
    case 'CallExpression':
      for (const arg of node.arguments) collectStrings(arg, out);
      break;
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
      collectStrings(node.expression, out);
      break;
    default:
      break;
  }
}

/**
 * @param {RuleContext} context
 * @param {{ node: Node, value: string }[]} fragments
 * @param {'shadow' | 'weight' | 'hex'} kind
 */
function check(context, fragments, kind) {
  const all = fragments.flatMap((f) => f.value.split(/\s+/).filter(Boolean));
  const hasSerif = all.some((t) => baseUtility(t) === SERIF);

  for (const { node, value } of fragments) {
    for (const token of value.split(/\s+/).filter(Boolean)) {
      const base = baseUtility(token);
      if (kind === 'shadow' && SHADOW_RE.test(base)) {
        context.report({ node, messageId: 'shadow', data: { token } });
      } else if (kind === 'weight') {
        if (HEAVY_WEIGHT_RE.test(base)) {
          context.report({ node, messageId: 'heavy', data: { token } });
        } else if (base === MEDIUM_WEIGHT && !hasSerif) {
          context.report({ node, messageId: 'medium', data: { token } });
        }
      } else if (kind === 'hex' && HEX_RE.test(token)) {
        context.report({ node, messageId: 'hex', data: { token } });
      }
    }
  }
}

/**
 * @param {'shadow' | 'weight' | 'hex'} kind
 * @param {Record<string, string>} messages
 * @param {string} description
 * @returns {RuleModule}
 */
function makeRule(kind, messages, description) {
  return {
    meta: { type: 'problem', docs: { description }, schema: [], messages },
    create(context) {
      return {
        /** @param {any} node */
        JSXAttribute(node) {
          if (node.name.type !== 'JSXIdentifier' || !CLASS_ATTRIBUTES.has(node.name.name)) return;
          /** @type {{ node: Node, value: string }[]} */
          const fragments = [];
          collectStrings(node.value, fragments);
          check(context, fragments, kind);
        },
        /** @param {any} node */
        CallExpression(node) {
          if (node.callee.type !== 'Identifier' || !CLASS_HELPERS.has(node.callee.name)) return;
          // A helper nested in a className attribute is already covered by JSXAttribute.
          /** @type {any} */
          let parent = node.parent;
          while (parent) {
            if (parent.type === 'JSXAttribute' && CLASS_ATTRIBUTES.has(parent.name?.name)) return;
            if (parent.type === 'CallExpression' && CLASS_HELPERS.has(parent.callee?.name)) return;
            parent = parent.parent;
          }
          /** @type {{ node: Node, value: string }[]} */
          const fragments = [];
          collectStrings(node, fragments);
          check(context, fragments, kind);
        },
      };
    },
  };
}

const plugin = {
  meta: { name: 'design-system' },
  rules: {
    'no-shadow-classes': makeRule(
      'shadow',
      { shadow: '"{{token}}": shadows are banned — the design is flat (DESIGN.md › Elevation).' },
      'Disallow Tailwind shadow utilities.',
    ),
    'no-heavy-font-weight': makeRule(
      'weight',
      {
        heavy:
          '"{{token}}": no bold text — emphasis comes from serif, size or color (CLAUDE.md §6.2).',
        medium: '"{{token}}": font-medium is only allowed together with font-serif.',
      },
      'Disallow bold weights; allow font-medium only with font-serif.',
    ),
    'no-raw-hex-colors': makeRule(
      'hex',
      { hex: '"{{token}}": raw hex color — use a design token (src/styles/tokens.css).' },
      'Disallow hex color literals in class names.',
    ),
  },
};

export default plugin;
