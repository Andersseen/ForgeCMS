import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { useOwnThrottleBucket } from './visitor';

useOwnThrottleBucket('accessibility');

const DEMO_EMAIL = 'demo@lumea.clinic';
const DEMO_PASSWORD = 'lumea-demo';

/** WCAG 2.2 AA (and the A / 2.1 levels it includes) — the one rule set every scan uses. */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Spec 086 (roadmap 0.11 / U02): this is the STYLED consumer — Tailwind plus the Volt theme — so, unlike
 * the unstyled `apps/tiny-project` fixture, nothing is excluded: contrast and target size run here too.
 * A violation fails with the rule id and the offending selectors.
 */
async function expectAccessible(page: Page, state: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map((violation) => ({
    state,
    rule: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(' '))
  }));
  expect(summary, `axe violations in: ${state}`).toEqual([]);
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input#email').fill(DEMO_EMAIL);
  await page.locator('input#password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/admin');
}

test('the content list, the editor, its errors, a confirmation and the pickers have no WCAG AA violations', async ({
  page
}) => {
  await signIn(page);

  await page.goto('/admin/collections/services');
  await expect(page.locator('volt-table-row').nth(1)).toBeVisible();
  await expectAccessible(page, 'collection workspace');

  // Delete confirmation on top of the list.
  await page
    .locator('volt-table-row')
    .nth(1)
    .getByRole('button', { name: /^Delete/ })
    .click();
  await expect(page.getByRole('dialog', { name: 'Delete this document?' })).toBeVisible();
  await expectAccessible(page, 'delete confirmation dialog');
  await page.keyboard.press('Escape');

  // The editor: composites, richtext and the upload picker are all on this collection.
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.locator('input#name')).toBeFocused();
  await expectAccessible(page, 'document editor');

  await page.getByRole('button', { name: /^Add row to Benefits/ }).click();
  await expect(page.locator('input[id="benefits.0.title"]')).toBeFocused();
  await expectAccessible(page, 'document editor with an array row');

  await page.getByRole('button', { name: 'Choose existing' }).click();
  await expect(page.getByRole('button', { name: 'Hide library' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  await expectAccessible(page, 'upload library open');
  await page.getByRole('button', { name: 'Hide library' }).click();

  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Fix the highlighted fields and try again.')).toBeVisible();
  await expect(page.locator('input#name')).toBeFocused();
  await expect(page.locator('input#name')).toHaveAttribute('aria-invalid', 'true');
  await expectAccessible(page, 'document editor with errors');

  // Relation picker with results (the category relation).
  await page.locator('input#category').fill('a');
  await expect(page.getByRole('list', { name: /Search results for/ })).toBeVisible();
  await expectAccessible(page, 'relation picker with results');
});

test('the users workspace has no WCAG AA violations', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
  await expectAccessible(page, 'users workspace');
});

// Roadmap 0.11 / U02: "primary actions remain usable on mobile" — measured, not assumed.
test('mobile: the editor fits the viewport and Create / Cancel stay reachable while the fields scroll', async ({
  page
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await signIn(page);
  await page.goto('/admin/collections/services/new');
  const dialog = page.getByRole('dialog', { name: 'New document' });
  await expect(dialog).toBeVisible();

  const metrics = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
  }));
  expect(metrics.overflowX).toBeLessThanOrEqual(0);

  const box = async (name: string) => {
    const handle = await dialog.getByRole('button', { name, exact: true }).boundingBox();
    expect(handle, `${name} has a box`).not.toBeNull();
    return handle as { x: number; y: number; width: number; height: number };
  };
  const inViewport = (rect: { x: number; y: number; width: number; height: number }) =>
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= metrics.width &&
    rect.y + rect.height <= metrics.height;

  // The CARD (not the full-screen overlay) fits the dynamic viewport, and its fields really scroll.
  const card = await dialog.locator('volt-card').boundingBox();
  expect(card).not.toBeNull();
  const { y, height } = card as { y: number; height: number };
  expect(y).toBeGreaterThanOrEqual(0);
  expect(y + height).toBeLessThanOrEqual(metrics.height);
  const scroller = dialog.locator('div.overflow-y-auto');
  expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const clipped = await dialog.evaluate((el) => {
    const card = el.querySelector('volt-card')!.getBoundingClientRect();
    return Array.from(el.querySelectorAll('input, textarea, button')).filter(
      (c) => c.getBoundingClientRect().right > card.right + 1
    ).length;
  });
  expect(clipped).toBe(0);

  // Before and after scrolling the fields to the bottom, the actions are on screen and tappable.
  expect(inViewport(await box('Create'))).toBe(true);
  expect(inViewport(await box('Cancel'))).toBe(true);
  await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(inViewport(await box('Create'))).toBe(true);
  expect(inViewport(await box('Cancel'))).toBe(true);
  const create = await box('Create');
  expect(Math.min(create.width, create.height)).toBeGreaterThanOrEqual(24); // WCAG 2.5.8

  await expectAccessible(page, 'document editor at 375px');
});
