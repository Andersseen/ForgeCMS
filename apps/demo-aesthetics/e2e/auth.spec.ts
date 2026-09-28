import { expect, test } from '@playwright/test';
import { useOwnThrottleBucket } from './visitor';

useOwnThrottleBucket('auth');

const DEMO_EMAIL = 'demo@lumea.clinic';
const DEMO_PASSWORD = 'lumea-demo';

/**
 * The clinic keeps its branded `/login` (it prints the demo accounts), but the session is the
 * package's: `ForgeAuthSession` + the `forge_session` cookie, a `forgeAuthGuard` on `/admin`, and the
 * shared layout's logout (spec 071). Until spec 071 the login page also stored a Bearer token in
 * `localStorage` and the client sent it on every request — so "Log out" cleared the cookie while the
 * stored token kept the admin signed in.
 */
test.describe('demo-aesthetics auth', () => {
  test('an anonymous visitor is sent from /admin to the clinic login and back', async ({
    page
  }) => {
    await page.goto('/admin/media');
    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fadmin%2Fmedia$/);

    await page.locator('input#email').fill(DEMO_EMAIL);
    await page.locator('input#password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/admin\/media$/);
  });

  test('staff accounts are admin-only: the front desk editor is sent back to the dashboard', async ({
    page
  }) => {
    await page.goto('/login');
    await page.locator('input#email').fill('frontdesk@lumea.clinic');
    await page.locator('input#password').fill('lumea-desk');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/admin');

    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('login sets a real session cookie and stores no token in the browser', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input#email').fill(DEMO_EMAIL);
    await page.locator('input#password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/admin');

    // Before spec 054 this app's login route never set a cookie at all — /me only worked via the
    // Authorization header the Angular app's own JS attaches. `page.request` is a plain HTTP client
    // that shares the browser's cookie jar but never runs that JS, so a 200 here can only mean the
    // cookie itself is carrying the session.
    const me = await page.request.get('/api/auth/me');
    expect(me.status()).toBe(200);
    const body = await me.json();
    expect(body.data.email).toBe(DEMO_EMAIL);

    const stored = await page.evaluate(() => ({ ...localStorage }));
    expect(Object.keys(stored).filter((key) => key !== 'forgecms-theme')).toEqual([]);
  });

  test('a session survives a full page reload via the cookie alone', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input#email').fill(DEMO_EMAIL);
    await page.locator('input#password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/admin');

    await page.reload();

    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  });

  test("logout clears the server session and returns to this app's own /login route", async ({
    page
  }) => {
    await page.goto('/login');
    await page.locator('input#email').fill(DEMO_EMAIL);
    await page.locator('input#password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/admin');

    await page.getByRole('button', { name: 'Log out' }).click();
    // ForgeAdminConfig.signInPath: '/login' (this app predates forgeAdminAuthRoutes()'s /admin/login
    // default) — proves the layout's configurable redirect, not just the hardcoded package default.
    await expect(page).toHaveURL(/\/login$/);

    const me = await page.request.get('/api/auth/me');
    expect(me.status()).toBe(401);

    // Nothing left in the browser keeps the admin open: the guard sends it back to sign in.
    await page.goto('/admin/collections/bookings');
    await expect(page).toHaveURL(/\/login\?returnUrl=/);
  });
});
