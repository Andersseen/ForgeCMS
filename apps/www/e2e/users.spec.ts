import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const DEMO_EMAIL = 'demo@forgecms.dev';
const DEMO_PASSWORD = 'forgecms-demo';

async function login(page: Page) {
  await page.goto('/admin/login');
  await page.locator('input#forge-signin-email').fill(DEMO_EMAIL);
  await page.locator('input#forge-signin-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/admin');
}

test('users admin flow: log in, create, edit, delete a user', async ({ page }) => {
  const email = `e2e-user-${Date.now()}@example.com`;
  const name = `E2E User ${Date.now()}`;
  const updatedName = `${name} (edited)`;

  await login(page);

  await page.goto('/admin/users');
  await page.getByRole('button', { name: 'New User' }).click();

  await page.locator('input#forge-user-name').fill(name);
  await page.locator('input#forge-user-email').fill(email);
  await page.locator('input#forge-user-password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create' }).click();

  const row = page.locator('volt-table-row', { hasText: email });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: /^Edit/ }).click();
  await expect(page.locator('input#forge-user-name')).toHaveValue(name);
  await page.locator('input#forge-user-name').fill(updatedName);
  await page.getByRole('button', { name: 'Save' }).click();

  const editedRow = page.locator('volt-table-row', { hasText: updatedName });
  await expect(editedRow).toBeVisible();

  await editedRow.getByRole('button', { name: /^Delete/ }).click();
  const confirmDialog = page.getByRole('dialog', { name: 'Delete this user?' });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(page.locator('volt-table-row', { hasText: updatedName })).toHaveCount(0);
});
