import { expect, test } from '@playwright/test';

const DEMO_EMAIL = 'demo@lumea.clinic';
const DEMO_PASSWORD = 'lumea-demo';

/**
 * `apps/demo-aesthetics` kept its own hand-rolled login page and `/admin` wiring unmigrated (spec 054
 * non-goals) — only its server auth routes were brought up to spec 053's contract, which is exactly
 * what this suite proves: login now actually sets the `forge_session` cookie (it didn't before, since
 * this app's `login.post.ts` hand-rolled `auth.login()` directly and never called `handleLogin`), and
 * the shared `ForgeAdminLayoutComponent`'s logout/session state (now cookie-aware, spec 054) works
 * correctly against this app's own `/login` route via its configured `signInPath`.
 */
test.describe('demo-aesthetics auth (spec 054 companion fix)', () => {
  test('login sets a real session cookie, not just a Bearer token in localStorage', async ({
    page
  }) => {
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
  });
});
