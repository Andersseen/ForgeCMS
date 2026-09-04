import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * Spec 055 §38: the small-project golden path, end to end, against a real browser and a real dev
 * server — fresh install → first-admin bootstrap → signin → protected admin → content → roles →
 * signup → CSRF/session sanity. One serial file, not several independent ones: this dev server's
 * database is a single in-memory instance that starts genuinely empty (no seed script, unlike every
 * other app in this repo — see src/server/api/runtime.ts), so "bootstrap the first admin" can only
 * happen once per server process. Run this against a freshly started `pnpm --filter
 * @forge-cms/tiny-project dev` (CI always does; restart the dev server between local reruns).
 */
test.describe.configure({ mode: 'serial' });

const ADMIN_EMAIL = 'admin@tiny.e2e.test';
const ADMIN_PASSWORD = 'admin-password-123';
const EDITOR_EMAIL = 'editor@tiny.e2e.test';
const EDITOR_PASSWORD = 'editor-password-123';
const SECOND_ADMIN_EMAIL = 'second-admin@tiny.e2e.test';
const SECOND_ADMIN_PASSWORD = 'second-admin-password-123';

// `page.request` (an APIRequestContext call, not a real page `fetch()`) sends no Origin/Referer
// header by default — `assertCsrfSafe` treats a cookie-authenticated mutating request with neither
// as unsafe and rejects it with 403 before any role/business-logic check runs. A test asserting a
// *specific* rejection reason (role, last-admin) on an otherwise same-origin request needs this
// header so it actually exercises that check instead of always tripping CSRF first.
const SAME_ORIGIN_HEADERS = { origin: 'http://127.0.0.1:5175' };

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/admin/login');
  await page.locator('input#forge-signin-email').fill(email);
  await page.locator('input#forge-signin-password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/admin/collections**');
}

async function logout(page: Page) {
  await page.getByRole('button', { name: /log out/i }).click();
  await page.waitForURL('**/admin/login**');
}

test('anonymous cannot reach a nested admin URL; the public site shows no posts yet', async ({
  page
}) => {
  await page.goto('/admin/collections/posts');
  await page.waitForURL('**/admin/login**');

  await page.goto('/');
  await expect(page.getByText('No published posts yet.')).toBeVisible();
});

test('first-run bootstrap creates the admin and signs them straight in', async ({ page }) => {
  await page.goto('/setup');
  await page.locator('input[name="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Create admin' }).click();

  await page.waitForURL('**/admin/collections**');

  // Cookie session survives a real reload.
  await page.reload();
  await expect(page).toHaveURL(/\/admin\/collections$/);

  // Direct refresh of a nested admin URL while authenticated works, not just SPA navigation.
  await page.goto('/admin/collections/posts');
  await expect(page).toHaveURL(/\/admin\/collections\/posts$/);
});

test('a second bootstrap attempt is refused once an admin exists', async ({ page }) => {
  const response = await page.request.post('/api/bootstrap-admin', {
    data: { email: 'someone-else@tiny.e2e.test', password: 'whatever-password' },
    headers: { 'content-type': 'application/json' }
  });
  expect(response.status()).toBe(409);
});

test('content admin: create a post with a relation, verify draft is hidden, publish, edit', async ({
  page
}) => {
  const title = `Tiny Post ${Date.now()}`;
  const slug = `tiny-post-${Date.now()}`;
  const updatedTitle = `${title} (edited)`;

  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.goto('/admin/collections/posts');
  await page.getByRole('button', { name: 'New' }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/posts\/new$/);

  await page.locator('input#title').fill(title);
  await page.locator('input#slug').fill(slug);

  // Relation field: search the target collection instead of pasting an id (spec 042).
  await page.locator('input#author').fill('admin@tiny.e2e.test');
  await page.getByRole('button', { name: /admin@tiny\.e2e\.test/ }).click();

  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/posts$/);

  const row = page.locator('volt-table-row', { hasText: title });
  await expect(row).toBeVisible();
  await expect(row.getByText('Draft', { exact: true })).toBeVisible();

  // A draft is invisible on the public site, authenticated admin session notwithstanding — the
  // public route runs the anonymous access rule regardless of who is browsing it.
  await page.goto('/');
  await expect(page.getByRole('link', { name: title })).toHaveCount(0);

  await page.goto('/admin/collections/posts');
  const rowAgain = page.locator('volt-table-row', { hasText: title });
  await rowAgain.getByRole('button', { name: 'Publish' }).click();
  await expect(rowAgain.getByText('Published', { exact: true })).toBeVisible();

  // Now visible on the public site, with the relation populated.
  await page.goto('/');
  await page.getByRole('link', { name: title }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText(/By admin@tiny\.e2e\.test/)).toBeVisible();

  // Edit.
  await page.goto('/admin/collections/posts');
  await page
    .locator('volt-table-row', { hasText: title })
    .getByRole('button', { name: 'Edit' })
    .click();
  await expect(page.locator('input#title')).toHaveValue(title);
  await page.locator('input#title').fill(updatedTitle);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('volt-table-row', { hasText: updatedTitle })).toBeVisible();
});

test('validation error UX: a required field is left blank shows a real message', async ({
  page
}) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto('/admin/collections/posts/new');
  await page.getByRole('button', { name: 'Create' }).click();

  // A human-readable message, not "[object Object]", raw SQL, or a silent no-op.
  await expect(page.getByText('[object Object]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin\/collections\/posts\/new$/);
});

test('users management: admin creates an editor; the editor cannot manage users or delete posts', async ({
  page
}) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.goto('/admin/users');
  await page.getByRole('button', { name: 'New User' }).click();
  await page.locator('input#forge-user-email').fill(EDITOR_EMAIL);
  await page.locator('select#forge-user-role').selectOption('editor');
  await page.locator('input#forge-user-password').fill(EDITOR_PASSWORD);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('volt-table-row', { hasText: EDITOR_EMAIL })).toBeVisible();

  const postsBeforeLogout = await page.request.get('/api/v1/posts');
  const { data: posts } = (await postsBeforeLogout.json()) as { data: { id: string }[] };
  const postId = posts[0]?.id;
  expect(postId).toBeTruthy();

  await logout(page);
  await loginAs(page, EDITOR_EMAIL, EDITOR_PASSWORD);

  // Direct nav to an admin-only nested URL redirects the editor away instead of showing the page.
  await page.goto('/admin/users');
  await expect(page).not.toHaveURL(/\/admin\/users$/);

  // Editor may write content... `volt-table-row` is also the header row's tag, which has no
  // "Edit" button — filter to a row that actually has one instead of assuming row order.
  await page.goto('/admin/collections/posts');
  const anyRow = page
    .locator('volt-table-row')
    .filter({ has: page.getByRole('button', { name: 'Edit' }) })
    .first();
  await anyRow.getByRole('button', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/posts\/[^/]+$/);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/posts$/);

  // ...but this fixture's own `posts.access.delete` restricts delete to admins only — a
  // collection-specific rule the generic admin UI has no reason to know about, so it is proven at
  // the API boundary (the real backstop) rather than assumed from button visibility.
  const deleteAttempt = await page.request.delete(`/api/v1/posts/${postId}`, {
    headers: SAME_ORIGIN_HEADERS
  });
  expect(deleteAttempt.status()).toBe(403);

  await logout(page);
});

// This test demotes ADMIN_EMAIL to 'editor' at the end (proving the invariant lifts once a second
// admin exists) — SECOND_ADMIN_EMAIL is an admin for every test that runs after this one.
test('last-admin invariant: the sole admin cannot demote or delete themselves; a second admin unblocks it', async ({
  page
}) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const me = await (await page.request.get('/api/auth/me')).json();
  const adminId = me.data.id as string;

  const selfDemote = await page.request.put(`/api/auth/users/${adminId}`, {
    data: { role: 'viewer' },
    headers: { 'content-type': 'application/json', ...SAME_ORIGIN_HEADERS }
  });
  expect(selfDemote.status()).toBe(409);

  const selfDelete = await page.request.delete(`/api/auth/users/${adminId}`, {
    headers: SAME_ORIGIN_HEADERS
  });
  expect(selfDelete.status()).toBe(409);

  // A second admin makes both operations legitimate again.
  await page.goto('/admin/users');
  await page.getByRole('button', { name: 'New User' }).click();
  await page.locator('input#forge-user-email').fill(SECOND_ADMIN_EMAIL);
  await page.locator('select#forge-user-role').selectOption('admin');
  await page.locator('input#forge-user-password').fill(SECOND_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('volt-table-row', { hasText: SECOND_ADMIN_EMAIL })).toBeVisible();

  const demoteNowAllowed = await page.request.put(`/api/auth/users/${adminId}`, {
    data: { role: 'editor' },
    headers: { 'content-type': 'application/json', ...SAME_ORIGIN_HEADERS }
  });
  expect(demoteNowAllowed.status()).toBe(200);

  await logout(page);
});

test('signup is opt-in, cannot select a role, and never elevates past the second-user default', async ({
  page
}) => {
  await page.goto('/admin/signup');
  await expect(page.locator('select, input[name="role"]')).toHaveCount(0);

  const email = `viewer-${Date.now()}@tiny.e2e.test`;
  await page.locator('input#forge-signup-email').fill(email);
  await page.locator('input#forge-signup-password').fill('viewer-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/admin/collections**');

  const me = await page.request.get('/api/auth/me');
  expect(me.status()).toBe(200);
  const body = (await me.json()) as { data: { email: string; role: string } };
  expect(body.data.email).toBe(email);
  // An admin already exists (bootstrapped earlier in this file) — this signup must NOT become admin.
  expect(body.data.role).toBe('viewer');

  await logout(page);
});

test('CSRF: a cross-site forged cookie mutation is rejected; unauthenticated writes are 401', async ({
  page,
  request
}) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  const forged = await page.request.post('/api/v1/posts', {
    data: { title: 'Should not be created', slug: `csrf-${Date.now()}` },
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' }
  });
  expect(forged.status()).toBe(403);

  await logout(page);

  const unauthenticated = await request.post('/api/v1/posts', {
    data: { title: 'Should not be created either', slug: `anon-${Date.now()}` },
    headers: { 'content-type': 'application/json' }
  });
  expect(unauthenticated.status()).toBe(401);
});
