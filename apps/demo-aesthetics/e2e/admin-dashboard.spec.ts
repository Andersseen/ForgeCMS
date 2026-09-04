import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const DEMO_EMAIL = 'demo@lumea.clinic';
const DEMO_PASSWORD = 'lumea-demo';

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input#email').fill(DEMO_EMAIL);
  await page.locator('input#password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/admin');
}

test.describe('demo admin dashboard', () => {
  test('clinic settings is an admin route, not a blocking document modal', async ({ page }) => {
    await signIn(page);

    await page.goto('/admin/settings');

    await expect(page.getByRole('heading', { name: 'Clinic settings' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save settings' })).toBeVisible();

    await page.getByRole('link', { name: 'Media' }).click();
    await expect(page).toHaveURL(/\/admin\/media$/);
  });
});
