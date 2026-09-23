import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import plugin, { baseUtility } from './design-system.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const { rules } = plugin;

describe('baseUtility', () => {
  it.each([
    ['shadow-md', 'shadow-md'],
    ['md:hover:!shadow-lg', 'shadow-lg'],
    ['[&>p]:font-bold', 'font-bold'],
    ['-mt-4', 'mt-4'],
    ['font-bold!', 'font-bold'],
    ['[box-shadow:0_0_2px_black]', '[box-shadow:0_0_2px_black]'],
    ['bg-[url(a:b)]', 'bg-[url(a:b)]'],
  ])('%s → %s', (input, expected) => {
    expect(baseUtility(input)).toBe(expected);
  });
});

tester.run('no-shadow-classes', rules['no-shadow-classes'], {
  valid: [
    '<div className="bg-pure-white border border-mist" />',
    '<div className="shadowy-thing-not-tailwind" />',
    'const label = "shadow-md";', // plain strings outside class contexts are ignored
    '<div title="shadow-md" />',
  ],
  invalid: [
    { code: '<div className="p-20 shadow-md" />', errors: [{ messageId: 'shadow' }] },
    { code: '<div className="shadow" />', errors: [{ messageId: 'shadow' }] },
    { code: '<div className="shadow-none" />', errors: [{ messageId: 'shadow' }] },
    { code: '<div className="md:hover:shadow-lg" />', errors: [{ messageId: 'shadow' }] },
    { code: '<div className="!shadow-sm" />', errors: [{ messageId: 'shadow' }] },
    { code: '<div className="shadow-ink-black/50" />', errors: [{ messageId: 'shadow' }] },
    { code: '<img className="drop-shadow-xl" />', errors: [{ messageId: 'shadow' }] },
    { code: '<div className="inset-shadow-sm" />', errors: [{ messageId: 'shadow' }] },
    { code: '<p className="text-shadow-md" />', errors: [{ messageId: 'shadow' }] },
    { code: '<div className="shadow-[0_0_4px_black]" />', errors: [{ messageId: 'shadow' }] },
    { code: '<div className="[box-shadow:0_0_4px_black]" />', errors: [{ messageId: 'shadow' }] },
    { code: '<div class="shadow-md" />', errors: [{ messageId: 'shadow' }] },
    { code: '<div className={`p-4 ${x} shadow-md`} />', errors: [{ messageId: 'shadow' }] },
    { code: '<div className={on ? "shadow-md" : "p-4"} />', errors: [{ messageId: 'shadow' }] },
    { code: '<div className={on && "shadow-md"} />', errors: [{ messageId: 'shadow' }] },
    {
      code: '<div className={cn("p-4", { "shadow-md": on })} />',
      errors: [{ messageId: 'shadow' }],
    },
    { code: 'const c = clsx("p-4", ["shadow-md"]);', errors: [{ messageId: 'shadow' }] },
    {
      code: 'const v = cva("p-4", { variants: { raised: { true: "shadow-lg" } } });',
      errors: [{ messageId: 'shadow' }],
    },
  ],
});

tester.run('no-heavy-font-weight', rules['no-heavy-font-weight'], {
  valid: [
    '<p className="font-sans font-normal" />',
    '<h1 className="font-serif font-medium text-heading" />',
    '<h1 className="md:font-medium font-serif" />',
    '<h1 className={cn("font-serif", big && "font-medium")} />',
  ],
  invalid: [
    { code: '<p className="font-bold" />', errors: [{ messageId: 'heavy' }] },
    { code: '<p className="font-semibold" />', errors: [{ messageId: 'heavy' }] },
    { code: '<p className="font-extrabold" />', errors: [{ messageId: 'heavy' }] },
    { code: '<p className="font-black" />', errors: [{ messageId: 'heavy' }] },
    { code: '<p className="hover:font-bold" />', errors: [{ messageId: 'heavy' }] },
    // Serif doesn't excuse bold — only 400/500 exist in the system.
    { code: '<h1 className="font-serif font-bold" />', errors: [{ messageId: 'heavy' }] },
    { code: '<p className="font-medium" />', errors: [{ messageId: 'medium' }] },
    { code: '<p className="font-sans font-medium" />', errors: [{ messageId: 'medium' }] },
    { code: '<p className="font-mono md:font-medium" />', errors: [{ messageId: 'medium' }] },
    { code: 'const c = cn("text-body", "font-medium");', errors: [{ messageId: 'medium' }] },
  ],
});

tester.run('no-raw-hex-colors', rules['no-raw-hex-colors'], {
  valid: [
    '<div className="bg-coral-pop text-pure-white" />',
    '<a className="underline" href="#section-12" />',
    '<div className="[&:nth-child(2)]:p-4" />',
  ],
  invalid: [
    { code: '<div className="bg-[#fa7864]" />', errors: [{ messageId: 'hex' }] },
    { code: '<div className="text-[#FFF]" />', errors: [{ messageId: 'hex' }] },
    { code: '<div className="border-[#00000080]" />', errors: [{ messageId: 'hex' }] },
    { code: '<div className="hover:bg-[#abc]" />', errors: [{ messageId: 'hex' }] },
    { code: '<div className="[color:#123456]" />', errors: [{ messageId: 'hex' }] },
    { code: '<div className={cn("p-4", "outline-[#000]")} />', errors: [{ messageId: 'hex' }] },
  ],
});
