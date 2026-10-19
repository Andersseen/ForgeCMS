import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const TRACKER = 'https://umami.andersseen.dev/script.js';

async function visitAsProduction(page: Page): Promise<void> {
  await page.route('http://forgecms.dev:5173/**', async (route) => {
    await route.continue({
      url: route.request().url().replace('http://forgecms.dev:5173', 'http://127.0.0.1:5173')
    });
  });
  await page.goto('http://forgecms.dev:5173/');
}

test('local development never loads the production tracker, even with a saved choice', async ({
  page
}) => {
  await page.addInitScript(() => localStorage.setItem('forgecms-analytics-consent', 'accepted'));
  await page.goto('/');
  await expect(page.locator(`script[src="${TRACKER}"]`)).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Privacy choices' })).toHaveCount(0);
});

test('privacy notice is prerenderable and exposes consent controls', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Website audience measurement' })).toBeVisible();
  await expect(page.getByText(/server-side retention period is currently unknown/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allow analytics' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep analytics disabled' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Privacy', exact: true })).toBeVisible();
});

for (const mode of ['light', 'dark'] as const) {
  test(`consent banner uses the ${mode} site palette and fits mobile`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((theme) => localStorage.setItem('forgecms-theme', theme), mode);
    await visitAsProduction(page);

    const banner = page.getByRole('complementary', { name: 'Optional audience analytics' });
    await expect(banner).toBeVisible();
    const colors = await banner.evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      foreground: getComputedStyle(element).color,
      width: element.getBoundingClientRect().width,
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));
    expect(colors.background).toBe(mode === 'dark' ? 'rgb(34, 36, 42)' : 'rgb(255, 255, 255)');
    expect(colors.foreground).toBe(mode === 'dark' ? 'rgb(243, 243, 245)' : 'rgb(32, 33, 40)');
    expect(colors.width).toBe(colors.viewport);
    expect(colors.scrollWidth).toBeLessThanOrEqual(colors.viewport + 1);
    await expect(banner.getByRole('button', { name: 'Allow analytics' })).toBeVisible();

    await page.setViewportSize({ width: 1440, height: 900 });
    const layout = await banner.evaluate((element) => {
      const copy = element.querySelector('.forge-analytics-consent-copy')!.getBoundingClientRect();
      const actions = element
        .querySelector('.forge-analytics-consent-actions')!
        .getBoundingClientRect();
      return {
        height: element.getBoundingClientRect().height,
        copyRight: copy.right,
        actionsLeft: actions.left
      };
    });
    expect(layout.height).toBeLessThan(150);
    expect(layout.copyRight).toBeLessThan(layout.actionsLeft);

    await banner.getByRole('button', { name: 'Continue without analytics' }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(banner).toHaveCount(0);
  });
}
