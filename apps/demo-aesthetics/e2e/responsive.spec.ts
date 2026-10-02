import { expect, test, type Page } from '@playwright/test';
import { guardConsole } from './console-guard';
import { useOwnThrottleBucket } from './visitor';

useOwnThrottleBucket('responsive');

/**
 * Spec 075 visual QA, mechanised: no horizontal page overflow and no unexpected console error on the
 * clinic's public pages and the main admin screens, at the four audited widths.
 */
const WIDTHS = [390, 768, 1440, 1920];
const PUBLIC = [
  '/',
  '/services',
  '/services/signature-hydraglow-facial',
  '/team',
  '/journal',
  '/booking',
  '/login'
];
const ADMIN = [
  '/admin',
  '/admin/collections/services',
  '/admin/media',
  '/admin/users',
  '/admin/analytics'
];

/** Text-bearing elements whose box ends past the viewport — clipped content `scrollWidth` cannot see. */
async function clippedElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return Array.from(document.querySelectorAll('h1, h2, h3, p, a, button, code, label, input, li'))
      .filter((el) => {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return false;
        if (el.closest('pre, [data-scroll-x], table, .overflow-x-auto')) return false;
        return box.right > width + 1;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 40)}"`);
  });
}

async function expectNoOverflow(page: Page, path: string, width: number): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(
    overflow,
    `${path} overflows horizontally at ${width}px by ${overflow}px`
  ).toBeLessThanOrEqual(0);
  expect(await clippedElements(page), `${path} at ${width}px`).toEqual([]);
}

for (const width of WIDTHS) {
  test(`public pages fit ${width}px`, async ({ page }) => {
    const problems = guardConsole(page);
    await page.setViewportSize({ width, height: 900 });
    for (const path of PUBLIC) {
      await page.goto(path);
      await expect(page.locator('main, [role="main"], body').first()).toBeVisible();
      await expect(page.getByText(/^Loading/)).toHaveCount(0);
      await expectNoOverflow(page, path, width);
    }
    expect(problems).toEqual([]);
  });
}

for (const width of [390, 1440]) {
  test(`admin screens fit ${width}px`, async ({ page }) => {
    const problems = guardConsole(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/login');
    await page.locator('input#email').fill('demo@lumea.clinic');
    await page.locator('input#password').fill('lumea-demo');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/admin/);
    for (const path of ADMIN) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectNoOverflow(page, path, width);
    }
    expect(problems).toEqual([]);
  });
}
