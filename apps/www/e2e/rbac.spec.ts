import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const DEMO_EMAIL = 'demo@forgecms.dev';
const DEMO_PASSWORD = 'forgecms-demo';

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('input#email').fill(email);
  await page.locator('input#password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/admin/collections');
}

async function createUser(
  page: Page,
  { name, email, password, role }: { name: string; email: string; password: string; role: string }
) {
  await page.goto('/admin/users');
  await page.getByRole('button', { name: 'New User' }).click();
  await page.locator('input#user-name').fill(name);
  await page.locator('input#user-email').fill(email);
  await page.locator('input#user-password').fill(password);
  await page.locator('select#user-role').selectOption(role);
  await page.getByRole('button', { name: 'Create' }).click();
  const row = page.locator('volt-table-row', { hasText: email });
  await expect(row).toBeVisible();
}

async function createDocument(page: Page, title: string, slug: string) {
  await page.goto('/admin/collections/posts');
  await page.getByRole('button', { name: /New/i }).click();
  await page.locator('input#title').fill(title);
  await page.locator('input#slug').fill(slug);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('volt-table-row', { hasText: title })).toBeVisible();
}

async function getAuthToken(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem('forge-auth-token'));
}

async function verifyCannotCreateDocument(page: Page, title: string, slug: string) {
  await page.goto('/admin/collections/posts');
  // Viewers should not see the New button.
  await expect(page.getByRole('button', { name: /New/i })).not.toBeVisible();
  // Directly navigating to the form via URL doesn't exist; the form is inline. Attempting to
  // trigger create via the API should be blocked by the backend too.
  const token = await getAuthToken(page);
  const response = await page.request.post('/api/v1/posts', {
    data: { title, slug },
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` })
    }
  });
  expect(response.status()).toBe(403);
}

async function verifyCannotAccessUsers(page: Page) {
  await page.goto('/admin/users');
  await expect(page.locator('text=Access denied')).toBeVisible();
  const token = await getAuthToken(page);
  const response = await page.request.get('/api/auth/users', {
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` })
    }
  });
  expect(response.status()).toBe(403);
}

test('role-based access control: admin, editor, and viewer permissions', async ({ page }) => {
  const timestamp = Date.now();
  const editorEmail = `editor-${timestamp}@example.com`;
  const viewerEmail = `viewer-${timestamp}@example.com`;
  const editorPost = `Editor Post ${timestamp}`;
  const editorSlug = `editor-post-${timestamp}`;
  const viewerPost = `Viewer Post ${timestamp}`;
  const viewerSlug = `viewer-post-${timestamp}`;

  // Admin creates editor and viewer.
  await login(page, DEMO_EMAIL, DEMO_PASSWORD);
  await createUser(page, {
    name: 'E2E Editor',
    email: editorEmail,
    password: 'e2e-password-123',
    role: 'editor'
  });
  await createUser(page, {
    name: 'E2E Viewer',
    email: viewerEmail,
    password: 'e2e-password-123',
    role: 'viewer'
  });

  // Editor can write content but cannot manage users.
  await login(page, editorEmail, 'e2e-password-123');
  await createDocument(page, editorPost, editorSlug);
  await verifyCannotAccessUsers(page);

  // Viewer cannot write content or manage users.
  await login(page, viewerEmail, 'e2e-password-123');
  await verifyCannotCreateDocument(page, viewerPost, viewerSlug);
  await verifyCannotAccessUsers(page);
});
