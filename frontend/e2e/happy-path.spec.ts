import type { Page } from '@playwright/test';

import {
  expect,
  expectDesignRules,
  expectNoA11yViolations,
  test,
  type E2EUser,
  type Translate,
} from './fixtures';

/**
 * CLAUDE.md §9 / PRD §13: create → join by link → exclusions (infeasible, then fixed) →
 * reveal → one receiver each, never the excluded person → wishlist item with a photo →
 * anonymous chat that never exposes the initiator. An axe scan runs at each major screen.
 *
 * Four people, not three: with three, any exclusion pair already makes the draw
 * impossible (both excluded people would have to give to the third), so a *feasible*
 * exclusion needs a fourth participant.
 */

// A real 1×1 PNG: the server decodes, re-encodes to WebP and makes a thumbnail.
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function futureLocalInput(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T18:00`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "Secret Elf #N" / "Elfo secreto #N" for any N. */
function aliasPattern(t: Translate): RegExp {
  const [before = '', after = ''] = t('chat.member.anonymous', { n: '\u0000' }).split('\u0000');
  return new RegExp(`${escapeRegExp(before)}\\d+${escapeRegExp(after)}`);
}

async function openTab(page: Page, t: Translate, tab: string) {
  await page.getByRole('tab', { name: t(`events.detail.tabs.${tab}`), exact: true }).click();
}

async function receiverOf(user: E2EUser, t: Translate, eventId: string): Promise<string> {
  await user.page.goto(`/events/${eventId}`);
  const card = user.page.getByRole('region', { name: t('draw.givingTo.title') });
  await expect(card).toBeVisible();
  return (await card.locator('p.font-serif').innerText()).trim();
}

test('host → join → exclusions → reveal → wishlist → anonymous chat', async ({ newUser, t }) => {
  const [host, beto, carla, dani] = await Promise.all([
    newUser('Ana'),
    newUser('Beto'),
    newUser('Carla'),
    newUser('Dani'),
  ]);
  const everyone = [host, beto, carla, dani];
  let eventId = '';
  let inviteUrl = '';

  await test.step('host creates the event', async () => {
    const page = host.page;
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoA11yViolations(page, 'dashboard');

    // Keyboard: the first Tab lands on a visible, full-size "skip to content" pill.
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: t('nav.skipToContent') });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await expectDesignRules(page, 'skip link focused');
    await page.keyboard.press('Escape');

    await page
      .getByRole('link', { name: t('events.dashboard.create') })
      .first()
      .click();
    await expect(page).toHaveURL(/\/events\/new$/);
    await expectNoA11yViolations(page, 'create event');

    await page.getByLabel(t('events.form.name'), { exact: true }).fill('Intercambio E2E');
    await page.getByLabel(t('events.form.budget'), { exact: true }).fill('25000');
    await page.getByLabel(t('events.form.exchangeAt'), { exact: true }).fill(futureLocalInput(30));
    await page.getByRole('button', { name: t('events.create.submit') }).click();
    await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}/);
    eventId = /\/events\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
    await expect(page.getByRole('heading', { level: 1, name: 'Intercambio E2E' })).toBeVisible();
    await expectNoA11yViolations(page, 'event overview (open)');
  });

  await test.step('host copies the invite link from Manage', async () => {
    const page = host.page;
    await openTab(page, t, 'manage');
    const url = page.getByTestId('invite-url');
    await expect(url).toContainText('/join/');
    inviteUrl = new URL((await url.innerText()).trim()).pathname;
    await expectNoA11yViolations(page, 'manage');
  });

  await test.step('three people join through the link', async () => {
    for (const [i, user] of [beto, carla, dani].entries()) {
      await user.page.goto(inviteUrl);
      const join = user.page.getByRole('button', { name: t('invites.join.join'), exact: true });
      await expect(join).toBeVisible();
      if (i === 0) await expectNoA11yViolations(user.page, 'join');
      await join.click();
      await expect(user.page).toHaveURL(new RegExp(`/events/${eventId}`));
    }
    await openTab(beto.page, t, 'participants');
    for (const user of everyone) {
      await expect(beto.page.getByText(user.name).first()).toBeVisible();
    }
    await expectNoA11yViolations(beto.page, 'participants');
  });

  await test.step('an impossible set of exclusions blocks the reveal, then gets fixed', async () => {
    const page = host.page;
    await page.reload();
    const status = page.locator('[data-feasible]');
    await expect(status).toHaveAttribute('data-feasible', 'true');

    // Ana, Beto and Carla may not draw each other: all three would need Dani.
    const group = page.getByRole('group', { name: t('exclusions.group.label') });
    for (const user of [host, beto, carla]) {
      await group.getByRole('button', { name: user.name }).click();
    }
    await page.getByRole('button', { name: t('exclusions.group.submit'), exact: true }).click();
    await expect(status).toHaveAttribute('data-feasible', 'false');
    await expect(status).toContainText(t('exclusions.infeasible'));
    const reveal = page.getByRole('button', { name: t('draw.reveal.button'), exact: true });
    await expect(reveal).toBeDisabled();
    await expectNoA11yViolations(page, 'manage (infeasible)');

    // Keep only Ana ⟷ Beto.
    for (const other of [host, beto]) {
      const label = (a: string, b: string) => t('exclusions.removeLabel', { a, b });
      await page
        .getByRole('button', { name: label(other.name, carla.name), exact: true })
        .or(page.getByRole('button', { name: label(carla.name, other.name), exact: true }))
        .click();
    }
    await expect(status).toHaveAttribute('data-feasible', 'true');
    await expect(
      page.getByRole('list', { name: t('exclusions.list') }).getByRole('listitem'),
    ).toHaveCount(1);
    await expect(reveal).toBeEnabled();
  });

  await test.step('the host reveals', async () => {
    const page = host.page;
    await page.getByRole('button', { name: t('draw.reveal.button'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expectNoA11yViolations(page, 'reveal confirmation');
    await dialog.getByRole('button', { name: t('draw.confirm.submit'), exact: true }).click();
    // Manage shows "the draw is done", or the app has already moved to the Overview card.
    await expect(
      page
        .getByRole('heading', { name: t('draw.reveal.doneTitle'), exact: true })
        .or(page.getByRole('region', { name: t('draw.givingTo.title') }))
        .first(),
    ).toBeVisible();
  });

  await test.step('everyone sees exactly one receiver, never themselves or the excluded one', async () => {
    const names = new Set(everyone.map((u) => u.name));
    const receivers = new Map<string, string>();
    for (const user of everyone) {
      const receiver = await receiverOf(user, t, eventId);
      expect(names.has(receiver), `${user.name} → ${receiver}`).toBe(true);
      expect(receiver).not.toBe(user.name);
      receivers.set(user.name, receiver);
    }
    await expectNoA11yViolations(host.page, 'overview (drawn)');
    expect(receivers.get(host.name)).not.toBe(beto.name);
    expect(receivers.get(beto.name)).not.toBe(host.name);
    // A permutation: everyone receives exactly once.
    expect(new Set(receivers.values()).size).toBe(everyone.length);
  });

  await test.step('a participant adds a wishlist item with a photo', async () => {
    const page = beto.page;
    const title = `Libro ${String(Date.now())}`;
    await page.goto(`/events/${eventId}/wishlists`);
    await page.getByRole('button', { name: t('wishlist.add'), exact: true }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel(t('wishlist.form.title')).fill(title);
    await sheet.getByRole('button', { name: t('wishlist.form.submitAdd'), exact: true }).click();
    await expect(page.getByText(title)).toBeVisible();

    await page.getByRole('button', { name: t('wishlist.item.editLabel', { title }) }).click();
    await page.getByTestId('photo-input').setInputFiles({
      name: 'gift.png',
      mimeType: 'image/png',
      buffer: PHOTO,
    });
    const alt = t('wishlist.photos.alt', { title, n: 1, total: 1 });
    await expect(page.getByRole('dialog').getByAltText(alt)).toBeVisible();
    await expectNoA11yViolations(page, 'wishlist item editor');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('wishlist.form.cancel') })
      .click();
    await expect(page.getByAltText(alt).first()).toBeVisible();
    await expectNoA11yViolations(page, 'wishlist');
  });

  await test.step('an anonymous chat never exposes the initiator', async () => {
    // Everything Dani's browser receives about chats: REST bodies and WebSocket frames.
    const seen: string[] = [];
    dani.page.on('response', (response) => {
      if (/\/api\/v1\/(conversations|messages|events\/[^/]+\/conversations)/.test(response.url())) {
        response.text().then(
          (body) => seen.push(body),
          () => undefined,
        );
      }
    });
    dani.page.on('websocket', (ws) => {
      ws.on('framereceived', (frame) => seen.push(String(frame.payload)));
    });
    await dani.page.goto('/chats');

    const message = `¿Qué te gustaría? ${String(Date.now())}`;
    const page = carla.page;
    await page.goto(`/events/${eventId}/chat`);
    await page.getByRole('button', { name: t('chat.eventTab.new'), exact: true }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: dani.name }).click();
    await sheet.getByRole('button', { name: t('chat.new.anonymous'), exact: true }).click();
    await expect(sheet.getByText(t('chat.new.anonymousHelp'))).toBeVisible();
    await sheet.getByRole('button', { name: t('chat.new.start'), exact: true }).click();
    await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}/);
    await expect(page.getByText(aliasPattern(t)).first()).toBeVisible();
    await page.getByRole('textbox', { name: t('chat.composer.label') }).fill(message);
    await page.getByRole('button', { name: t('chat.composer.send'), exact: true }).click();
    await expect(page.getByRole('list', { name: t('chat.thread.messagesLabel') })).toContainText(
      message,
    );
    await expectNoA11yViolations(page, 'thread (initiator)');

    // The recipient: a Secret Elf in the list and in the thread, and nothing else.
    const inbox = dani.page;
    await inbox.reload();
    const row = inbox.getByRole('link').filter({ hasText: aliasPattern(t) });
    await expect(row).toBeVisible();
    await expectNoA11yViolations(inbox, 'chats list');
    await row.click();
    await expect(inbox.getByText(message)).toBeVisible();
    await expect(inbox.getByText(aliasPattern(t)).first()).toBeVisible();
    await expectNoA11yViolations(inbox, 'thread (recipient)');

    for (const secret of [carla.name, carla.email, carla.id]) {
      await expect(inbox.locator('body')).not.toContainText(secret);
    }
    await inbox.waitForLoadState('networkidle');
    expect(seen.length).toBeGreaterThan(0);
    const raw = seen.join('\n');
    expect(raw).toContain(message);
    for (const secret of [carla.name, carla.email, carla.id]) {
      expect(raw, `the recipient's network traffic names the initiator`).not.toContain(secret);
    }
  });
});
