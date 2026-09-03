import { expect, test } from '@playwright/test';

const DEMO_EMAIL = 'demo@forgecms.dev';
const DEMO_PASSWORD = 'forgecms-demo';

/**
 * Covers the guard/session mechanics spec 054 adds — as opposed to `admin-crud.spec.ts` (content CRUD),
 * `users.spec.ts` (users workspace CRUD), and `rbac.spec.ts` (role matrix), which exercise the
 * authenticated app itself.
 */
test.describe('auth guard and session', () => {
  test('an anonymous visit to a protected route redirects to sign-in with a returnUrl, and signing in lands back there', async ({
    page
  }) => {
    await page.goto('/admin/collections/posts');

    await expect(page).toHaveURL(/\/admin\/login\?returnUrl=/);

    await page.locator('input#forge-signin-email').fill(DEMO_EMAIL);
    await page.locator('input#forge-signin-password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/admin\/collections\/posts$/);
  });

  test('a session survives a full page reload via the cookie alone', async ({ page }) => {
    await page.goto('/admin/login');
    await page.locator('input#forge-signin-email').fill(DEMO_EMAIL);
    await page.locator('input#forge-signin-password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/admin');

    await page.reload();

    // Still authenticated — no login form, the sidebar/content renders straight away.
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
    await expect(page).not.toHaveURL(/\/admin\/login/);
  });

  test('logout clears the server session, not just local UI state', async ({ page }) => {
    await page.goto('/admin/login');
    await page.locator('input#forge-signin-email').fill(DEMO_EMAIL);
    await page.locator('input#forge-signin-password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/admin');

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/admin\/login/);

    // The cookie itself is gone server-side, not merely ignored client-side.
    const me = await page.request.get('/api/auth/me');
    expect(me.status()).toBe(401);

    // Protected admin is unreachable again.
    await page.goto('/admin/collections/posts');
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
