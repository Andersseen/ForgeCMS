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

/**
 * The reusable content-admin workflow from `@forge-cms/admin` (spec 052), exercised against the
 * seed `posts` collection (`drafts: true`, `admin.useAsTitle: 'title'`): collections index → open a
 * collection → create → appears in list, titled → edit → save → publish/unpublish → filter
 * drafts/published → delete (with confirmation) → disappears. This is the acceptance test for the
 * whole milestone, not a test of any single presentational component.
 */
test('content admin: create, list, edit, publish, filter, delete', async ({ page }) => {
  const title = `E2E Post ${Date.now()}`;
  const slug = `e2e-post-${Date.now()}`;
  const updatedTitle = `${title} (edited)`;

  await login(page);

  // Collections index: no per-collection host page, just the package's reusable index.
  await page.goto('/admin/collections');
  await page.getByRole('link', { name: /^Posts/ }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/posts$/);

  // Create: navigates to a routed editor overlay, not an inline toggle.
  await page.getByRole('button', { name: 'New' }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/posts\/new$/);
  await page.locator('input#title').fill(title);
  await page.locator('input#slug').fill(slug);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/posts$/);

  // Appears in the list, titled (not a raw id) — `admin.useAsTitle: 'title'` at work — and as a
  // Draft (drafts: true defaults new documents to draft).
  const row = page.locator('volt-table-row', { hasText: title });
  await expect(row).toBeVisible();
  await expect(row.getByText('Draft', { exact: true })).toBeVisible();

  // Edit: routed editor, pre-filled with the existing value.
  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/posts\/[^/]+$/);
  await expect(page.locator('input#title')).toHaveValue(title);
  await page.locator('input#title').fill(updatedTitle);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/posts$/);

  const editedRow = page.locator('volt-table-row', { hasText: updatedTitle });
  await expect(editedRow).toBeVisible();

  // Publish, then filter by Published/Draft to prove the status filter actually queries the API.
  await editedRow.getByRole('button', { name: 'Publish' }).click();
  await expect(editedRow.getByText('Published', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Draft', exact: true }).click();
  await expect(page.locator('volt-table-row', { hasText: updatedTitle })).toHaveCount(0);

  await page.getByRole('button', { name: 'Published', exact: true }).click();
  await expect(page.locator('volt-table-row', { hasText: updatedTitle })).toBeVisible();

  await page.getByRole('button', { name: 'All', exact: true }).click();
  const finalRow = page.locator('volt-table-row', { hasText: updatedTitle });

  // Delete requires a styled confirmation, not a single icon click.
  await finalRow.getByRole('button', { name: 'Delete' }).click();
  const confirmDialog = page.getByRole('dialog', { name: 'Delete this document?' });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(page.locator('volt-table-row', { hasText: updatedTitle })).toHaveCount(0);
});

test('unsaved changes in the document editor prompt before navigating away', async ({ page }) => {
  await login(page);

  await page.goto('/admin/collections/posts/new');
  await page.locator('input#title').fill('Should prompt before leaving');

  let dialogSeen = false;
  page.once('dialog', (dialog) => {
    dialogSeen = true;
    void dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect.poll(() => dialogSeen).toBe(true);
  await expect(page).toHaveURL(/\/admin\/collections\/posts\/new$/);
});

test('the API still rejects an anonymous write even if the client were bypassed', async ({
  page
}) => {
  // The route guard (see auth.spec.ts for its redirect behavior) is UX only — this proves the server
  // remains the real backstop.
  const response = await page.request.post('/api/v1/posts', {
    data: { title: 'Should not be created', slug: `should-not-be-created-${Date.now()}` },
    headers: { 'content-type': 'application/json' }
  });
  expect(response.status()).toBe(401);
});
