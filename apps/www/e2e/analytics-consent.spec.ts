import { expect, test } from '@playwright/test';

const TRACKER = 'https://umami.andersseen.dev/script.js';

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
