import { readFileSync } from 'node:fs';

import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';

export type AppLocale = 'es' | 'en';

type Dict = Record<string, unknown>;

const dictionaries: Record<AppLocale, Dict> = {
  es: JSON.parse(readFileSync(new URL('../src/i18n/es.json', import.meta.url), 'utf8')) as Dict,
  en: JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8')) as Dict,
};

export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The app's own strings, so selectors follow the copy in both locales. */
export function translator(locale: AppLocale): Translate {
  return (key, params = {}) => {
    const value = key
      .split('.')
      .reduce<unknown>((node, part) => (node as Dict | undefined)?.[part], dictionaries[locale]);
    if (typeof value !== 'string') throw new Error(`missing ${locale} translation: ${key}`);
    return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params[name] ?? ''));
  };
}

export interface E2EUser {
  id: string;
  name: string;
  email: string;
  context: BrowserContext;
  page: Page;
}

const CSRF = { 'X-Requested-With': 'fetch' };

/**
 * A signed-in user in their own browser context (own cookies), with the project's
 * viewport. Signs in through the ENV=test login and saves the project's locale.
 */
async function signIn(
  browser: Browser,
  testInfo: TestInfo,
  locale: AppLocale,
  label: string,
): Promise<E2EUser> {
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor, baseURL } =
    testInfo.project.use;
  const context = await browser.newContext({
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
    baseURL,
    serviceWorkers: 'block',
  });
  // Unique per run and project, so parallel projects never share accounts.
  const tag = `${testInfo.project.name}-${String(Date.now())}-${String(testInfo.retry)}`;
  const name = `${label} ${tag}`;
  const email = `${label.toLowerCase()}.${tag}@e2e.test`;
  const login = await context.request.post('/api/v1/test/login', {
    data: { email, name },
    headers: CSRF,
  });
  expect(login.ok(), await login.text()).toBe(true);
  const { id } = (await login.json()) as { id: string };
  if (locale !== 'es') {
    const patch = await context.request.patch('/api/v1/me', { data: { locale }, headers: CSRF });
    expect(patch.ok()).toBe(true);
  }
  const page = await context.newPage();
  return { id, name, email, context, page };
}

/**
 * The per-screen check: no WCAG 2.1 A/AA violations (minus the documented coral exception),
 * then the design rules below.
 */
export async function expectNoA11yViolations(page: Page, step: string): Promise<void> {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = results.violations
    .map((violation) => ({
      ...violation,
      nodes: violation.nodes.filter((node) => !isCoralException(violation.id, node.any)),
    }))
    .filter((violation) => violation.nodes.length > 0);
  const report = violations.map(
    (v) =>
      `${v.id} (${v.impact ?? '?'}): ${v.help}\n` +
      v.nodes.map((n) => `  ${n.target.join(' ')}  ${n.failureSummary ?? ''}`).join('\n'),
  );
  expect(report, `axe violations at "${step}"`).toEqual([]);
  await expectDesignRules(page, step);
}

/**
 * CLAUDE.md §6.2 on the live page: at most one coral primary pill visible in the viewport
 * (the active nav pill doesn't count), at most one coral Banner on the screen, no element
 * with a box shadow, and every visible control at least 44×44 px. Inline text links are
 * exempt (WCAG 2.5.5); link-styled pills are not.
 */
export async function expectDesignRules(page: Page, step: string): Promise<void> {
  const found = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Visible in the viewport and not covered (e.g. by an open modal's backdrop).
    const onTop = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) return false;
      const x = Math.min(Math.max(r.left + r.width / 2, 0), vw - 1);
      const y = Math.min(Math.max(r.top + r.height / 2, 0), vh - 1);
      const hit = document.elementFromPoint(x, y);
      return hit !== null && (hit === el || el.contains(hit));
    };
    const coral = [...document.querySelectorAll('.bg-coral-pop')].filter(
      (el) => el.closest('nav') === null,
    );
    const describe = (el: Element) => el.textContent.trim().slice(0, 40);
    return {
      primaries: coral.filter((el) => el.matches('button, a') && onTop(el)).map(describe),
      banners: coral.filter((el) => !el.closest('button, a')).map(describe),
      shadows: [...document.querySelectorAll('body *')]
        .filter((el) => getComputedStyle(el).boxShadow !== 'none')
        .map(
          (el) => `${el.tagName.toLowerCase()}.${String(el.getAttribute('class')).slice(0, 60)}`,
        ),
      smallTargets: [
        ...document.querySelectorAll(
          'button, [role="button"], [role="tab"], [role="switch"], select, textarea, input, a.rounded-full-2',
        ),
      ]
        .filter((el) => el.closest('[aria-hidden="true"]') === null)
        // Visually hidden until focused (the skip link): measured when it has focus.
        .filter((el) => !el.classList.contains('sr-only') || document.activeElement === el)
        .filter((el) => !(el instanceof HTMLInputElement && el.type === 'hidden'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          // Skip what isn't rendered (and the visually-hidden file inputs).
          if (r.width <= 1 || r.height <= 1) return false;
          // An absolutely positioned ::after with negative insets extends the hit area
          // (the Switch's 48×28 track has a 64×44 target).
          const after = getComputedStyle(el, '::after');
          const grow = (side: string) =>
            after.content !== 'none' && after.position === 'absolute'
              ? Math.max(0, -parseFloat(side) || 0)
              : 0;
          const width = r.width + grow(after.left) + grow(after.right);
          const height = r.height + grow(after.top) + grow(after.bottom);
          return width < 43.5 || height < 43.5;
        })
        .map((el) => {
          const r = el.getBoundingClientRect();
          const name = el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 30);
          return `${el.tagName.toLowerCase()} "${name}" ${r.width.toFixed(0)}×${r.height.toFixed(0)}`;
        }),
    };
  });
  expect(
    found.primaries.length,
    `coral primaries in view at "${step}": ${found.primaries.join(' | ')}`,
  ).toBeLessThanOrEqual(1);
  expect(
    found.banners.length,
    `coral Banners at "${step}": ${found.banners.join(' | ')}`,
  ).toBeLessThanOrEqual(1);
  expect(found.shadows, `box shadows at "${step}"`).toEqual([]);
  expect(found.smallTargets, `hit targets under 44px at "${step}"`).toEqual([]);
}

/**
 * Wait for finite animations (a toast or modal fading in) so axe measures the real colors,
 * not a half-transparent frame. Infinite ones (spinners) are left alone.
 */
async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });
}

// PRD §9.4: Coral Pop (#fa7864) with white or cream (filled primary pills, the Banner, the
// active tab pill, the coral eyebrow labels) is a known contrast failure, kept by product
// decision and flagged for review. Nothing else is exempt.
const CORAL = '#fa7864';

function isCoralException(ruleId: string, checks: { data?: unknown }[]): boolean {
  if (ruleId !== 'color-contrast') return false;
  return checks.some((check) => {
    const data = check.data as { fgColor?: string; bgColor?: string } | undefined;
    return data?.fgColor?.toLowerCase() === CORAL || data?.bgColor?.toLowerCase() === CORAL;
  });
}

export const test = base.extend<
  {
    t: Translate;
    newUser: (label: string) => Promise<E2EUser>;
  },
  { appLocale: AppLocale }
>({
  appLocale: ['es', { option: true, scope: 'worker' }],
  t: async ({ appLocale }, use) => {
    await use(translator(appLocale));
  },
  newUser: async ({ browser, appLocale }, use, testInfo) => {
    const contexts: BrowserContext[] = [];
    await use(async (label) => {
      const user = await signIn(browser, testInfo, appLocale, label);
      contexts.push(user.context);
      return user;
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

export { expect };
