import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const DEMO_EMAIL = 'demo@forgecms.dev';
const DEMO_PASSWORD = 'forgecms-demo';

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input#email').fill(DEMO_EMAIL);
  await page.locator('input#password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/admin/collections');
}

test('admin CRUD flow: log in, create, edit, delete a document', async ({ page }) => {
  const slug = `e2e-post-${Date.now()}`;
  const title = `E2E Post ${Date.now()}`;
  const updatedTitle = `${title} (edited)`;

  await login(page);

  await page.goto('/admin/collections/posts');
  await page.getByRole('button', { name: /New/i }).click();
  await page.locator('input#title').fill(title);
  await page.locator('input#slug').fill(slug);
  await page.getByRole('button', { name: 'Create' }).click();

  const row = page.locator('volt-table-row', { hasText: title });
  await expect(row).toBeVisible();

  await row.locator('button').nth(0).click();
  await expect(page.locator('input#title')).toHaveValue(title);
  await page.locator('input#title').fill(updatedTitle);
  await page.getByRole('button', { name: 'Save' }).click();

  const editedRow = page.locator('volt-table-row', { hasText: updatedTitle });
  await expect(editedRow).toBeVisible();

  page.once('dialog', (dialog) => void dialog.accept());
  await editedRow.locator('button').nth(1).click();

  await expect(page.locator('volt-table-row', { hasText: updatedTitle })).toHaveCount(0);
});

test('anonymous users cannot create documents', async ({ page }) => {
  await page.goto('/admin/collections/posts');

  // The UI hides the write path for unauthenticated (read-only) users.
  await expect(page.getByRole('button', { name: /New/i })).not.toBeVisible();

  // The API also rejects anonymous write requests.
  const response = await page.request.post('/api/v1/posts', {
    data: { title: 'Should not be created', slug: `should-not-be-created-${Date.now()}` },
    headers: { 'content-type': 'application/json' }
  });
  expect(response.status()).toBe(401);
});
