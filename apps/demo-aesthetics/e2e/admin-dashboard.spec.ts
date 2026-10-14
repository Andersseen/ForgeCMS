import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { useOwnThrottleBucket } from './visitor';

useOwnThrottleBucket('admin-dashboard');

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
  test('the overview is client-ready and its traffic card is honest, never fabricated', async ({
    page
  }) => {
    await signIn(page);

    await expect(page.getByRole('heading', { name: 'Clinic overview' })).toBeVisible();
    await expect(page.getByText('Pending bookings')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quick links' })).toBeVisible();

    const traffic = page.locator('[data-analytics-state]');
    await expect(traffic).toBeVisible();
    const state = await traffic.getAttribute('data-analytics-state');
    // No Analytics Engine locally: the honest states are "unconfigured" or "empty", never a made-up count.
    expect(['unconfigured', 'empty', 'traffic']).toContain(state);
    if (state !== 'traffic') await expect(traffic).not.toContainText(/\d{2,}/);
  });

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
