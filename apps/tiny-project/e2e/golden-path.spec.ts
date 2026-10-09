import type { APIRequestContext, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
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

/**
 * Server-rendered pages show before Angular has hydrated them (spec 080): typing into a form earlier
 * would be wiped when the app attaches. Waits for the app to be bootstrapped and stable.
 */
async function hydrated(page: Page) {
  // Angular removes the `ngh` hydration annotation from a server-rendered element once it has hydrated it.
  await page.waitForFunction(() => document.querySelector('[ngh]') === null);
}

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/admin/login');
  await hydrated(page);
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

/** The server-rendered HTML of `path`, as a client without JavaScript (or cookies) receives it. */
async function serverHtml(request: APIRequestContext, path: string): Promise<string> {
  const response = await request.get(path, { headers: { accept: 'text/html' } });
  expect(response.status()).toBe(200);
  return response.text();
}

test('SSR (spec 078): the server renders the resolved public page, not a loading state', async ({
  request
}) => {
  const html = await serverHtml(request, '/');
  expect(html).toContain('<tiny-home-page');
  expect(html).toContain('No published posts yet.');
  expect(html).not.toContain('Loading…');
  expect(html).not.toContain('SERVER_ORIGIN_REQUIRED');

  const missing = await serverHtml(request, '/posts/does-not-exist');
  expect(missing).toContain('Not found');
});

test('hydration (spec 080): the browser reuses the server-rendered public read — no duplicate request', async ({
  page
}) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || /NG0\d+/.test(message.text())) problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  const reads: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/v1/posts')) reads.push(request.url());
  });

  await page.goto('/');
  await expect(page.getByText('No published posts yet.')).toBeVisible();
  // Hydrated: the app is interactive and stable, and no list request left the browser.
  await expect(page.locator('tiny-home-page')).toBeVisible();
  await page.waitForTimeout(500);
  expect(reads).toEqual([]);
  expect(problems).toEqual([]);

  // The state script carries only the public Forge result.
  const html = await (await page.request.get('/', { headers: { accept: 'text/html' } })).text();
  expect(html).toContain('forge:public:');
  expect(html).not.toMatch(/forge_session|authorization|bearer/i);
});

test('first-run bootstrap creates the admin and signs them straight in', async ({ page }) => {
  await page.goto('/setup');
  await hydrated(page);
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
  page,
  playwright
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
  await rowAgain.getByRole('button', { name: /^Publish/ }).click();
  await expect(rowAgain.getByText('Published', { exact: true })).toBeVisible();

  // Now visible on the public site. The public route reads as an anonymous user, and population
  // enforces the target collection's own read policy (spec 058 §4): `users` is authenticated-only,
  // so the author's email must NOT leak onto a public page even though the post itself is public.
  await page.goto('/');
  await page.getByRole('link', { name: title }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText(/admin@tiny\.e2e\.test/)).toHaveCount(0);

  // The same content is in the server-rendered HTML (spec 078), read as anonymous: no JS, no cookie.
  const detailPath = new URL(page.url()).pathname;
  const anonymous = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:5175' });
  expect(await serverHtml(anonymous, '/')).toContain(`>${title}</a>`);
  const detailHtml = await serverHtml(anonymous, detailPath);
  expect(detailHtml).toContain(`<h1>${title}</h1>`);
  expect(detailHtml).not.toContain('admin@tiny.e2e.test');
  await anonymous.dispose();

  // Edit.
  await page.goto('/admin/collections/posts');
  await page
    .locator('volt-table-row', { hasText: title })
    .getByRole('button', { name: /^Edit/ })
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

test('U01 (spec 085): a server-rejected save keeps every entered value; the corrected retry succeeds exactly once', async ({
  page
}) => {
  const stamp = Date.now();
  const title = `Reliable ${stamp}`;
  const slug = `reliable-${stamp}`;
  const created: number[] = [];
  page.on('response', (response) => {
    if (response.request().method() === 'POST' && /\/api\/v1\/posts$/.test(response.url())) {
      created.push(response.status());
    }
  });

  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto('/admin/collections/posts/new');
  await hydrated(page);
  await page.locator('input#title').fill(title);
  await page.locator('input#slug').fill(slug);

  // `author` is a required relation: the real server rejects the first attempt.
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Fix the highlighted fields and try again.')).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/collections\/posts\/new$/);
  await expect(page.locator('input#title')).toHaveValue(title);
  await expect(page.locator('input#slug')).toHaveValue(slug);
  await expect(page.getByRole('button', { name: 'Create' })).toBeEnabled();

  await page.locator('input#author').fill(ADMIN_EMAIL);
  await page.getByRole('button', { name: new RegExp(ADMIN_EMAIL.replace('.', '\\.')) }).click();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/posts$/);
  await expect(page.locator('volt-table-row', { hasText: title })).toBeVisible();

  expect(created.filter((status) => status === 201)).toHaveLength(1);
  expect(created.filter((status) => status >= 400)).toHaveLength(1);
});

test('U01 (spec 085): search and filter survive an editor round trip; a dirty editor asks before it is left', async ({
  page
}) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto('/admin/collections/posts');
  await hydrated(page);

  await page.locator('input[placeholder="Search…"]').fill('Reliable');
  await page.getByRole('button', { name: 'Draft', exact: true }).click();
  const row = page.locator('volt-table-row', { hasText: 'Reliable' }).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /^Edit/ }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/posts\/[^/]+$/);

  // Clean editor: leaving does not prompt, and the list is exactly as it was left.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/posts$/);
  await expect(page.locator('input[placeholder="Search…"]')).toHaveValue('Reliable');
  await expect(page.locator('volt-table-row', { hasText: 'Reliable' }).first()).toBeVisible();

  // Dirty editor: staying keeps the editor and the typed value (spec 086: a Forge dialog, not window.confirm).
  await page
    .locator('volt-table-row', { hasText: 'Reliable' })
    .first()
    .getByRole('button', { name: /^Edit/ })
    .click();
  await page.locator('input#title').fill('Reliable but changed');
  let nativePrompts = 0;
  page.on('dialog', (dialog) => {
    nativePrompts += 1;
    void dialog.dismiss();
  });
  const leave = page.getByRole('dialog', { name: 'Leave without saving?' });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Stay' }).click();
  await expect(leave).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin\/collections\/posts\/[^/]+$/);
  await expect(page.locator('input#title')).toHaveValue('Reliable but changed');

  // Leaving lets go — and the filters are still there on return.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await leave.getByRole('button', { name: 'Leave without saving' }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/posts$/);
  await expect(page.locator('input[placeholder="Search…"]')).toHaveValue('Reliable');
  expect(nativePrompts).toBe(0);
});

test('U01 (spec 085): cancelling a delete sends nothing; the row goes only after the server deletes it', async ({
  page
}) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto('/admin/collections/posts');
  await hydrated(page);

  const deletes: number[] = [];
  page.on('response', (response) => {
    if (response.request().method() === 'DELETE') deletes.push(response.status());
  });
  const row = page.locator('volt-table-row', { hasText: 'Reliable' }).first();
  const label = (await row.innerText()).split('\n')[0] ?? 'Reliable';
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: /^Delete/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row).toBeVisible();
  expect(deletes).toHaveLength(0);

  await row.getByRole('button', { name: /^Delete/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('volt-table-row', { hasText: label })).toHaveCount(0);
  expect(deletes).toEqual([204]);
});

// ---------------------------------------------------------------------------------------------------
// Spec 086 (roadmap 0.11 / U02): keyboard, focus and automated accessibility evidence.
// ---------------------------------------------------------------------------------------------------

/** WCAG 2.2 AA (and the A / 2.1 levels it includes) — the one rule set every scan uses. */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * The ONE excluded rule, documented in spec 086: `target-size` (WCAG 2.2 · 2.5.8). This fixture ships no
 * stylesheet at all (spec 055: "deliberately minimal"), so every control is at its browser-default size
 * rather than the admin's design — a measurement of that says nothing about the admin. The same rule runs,
 * unexcluded, against the styled consumer (`apps/demo-aesthetics/e2e/accessibility.spec.ts`).
 */
const UNSTYLED_FIXTURE_EXCLUSIONS = ['target-size'];

/**
 * Scans the page as it is right now. Every other rule in the tag set runs, and a violation fails with
 * its rule id and the offending selectors.
 */
async function expectAccessible(page: Page, state: string) {
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .disableRules(UNSTYLED_FIXTURE_EXCLUSIONS)
    .analyze();
  const summary = results.violations.map((violation) => ({
    state,
    rule: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(' '))
  }));
  expect(summary, `axe violations in: ${state}`).toEqual([]);
}

const focused = (page: Page) => page.locator(':focus');

/** The element with focus is inside `selector` (a modal's root). */
async function focusIsWithin(page: Page, selector: string): Promise<boolean> {
  return page.evaluate(
    (css) => document.querySelector(css)?.contains(document.activeElement) === true,
    selector
  );
}

test('U02 (spec 086): a keyboard-only editor signs in, corrects a server validation error, picks the required relation, publishes, guards unsaved edits, deletes and signs out', async ({
  page
}) => {
  const stamp = Date.now();
  const title = `Keyboard ${stamp}`;
  const slug = `keyboard-${stamp}`;
  const row = () => page.locator('volt-table-row', { hasText: title });

  // --- sign in, with Tab and Enter only ---------------------------------------------------------
  await page.goto('/admin/login');
  await hydrated(page);
  await page.locator('input#forge-signin-email').focus();
  await page.keyboard.type(ADMIN_EMAIL);
  await page.keyboard.press('Tab');
  await expect(focused(page)).toHaveAttribute('id', 'forge-signin-password');
  await page.keyboard.type(ADMIN_PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForURL('**/admin/collections**');

  // --- Posts → New (Enter on real controls) -----------------------------------------------------
  await page.getByRole('link', { name: /Posts/ }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/collections\/posts$/);
  const newButton = page.getByRole('button', { name: 'New', exact: true });
  await newButton.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/collections\/posts\/new$/);

  // Modal focus: inside on open, and Tab / Shift+Tab never leave it.
  const dialog = '[role="dialog"][aria-labelledby="forge-collection-form-title"]';
  await expect(page.locator(dialog)).toBeVisible();
  await expect(focused(page)).toHaveAttribute('id', 'title');
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press('Tab');
    expect(await focusIsWithin(page, dialog), `Tab #${i + 1} stayed in the dialog`).toBe(true);
  }
  for (let i = 0; i < 16; i += 1) {
    await page.keyboard.press('Shift+Tab');
    expect(await focusIsWithin(page, dialog), `Shift+Tab #${i + 1} stayed in the dialog`).toBe(
      true
    );
  }

  // --- a real server validation error: title and author are missing -----------------------------
  await page.locator('input#slug').focus();
  await page.keyboard.type(slug);
  await page.keyboard.press('Enter'); // implicit submit
  await expect(page.getByText('Fix the highlighted fields and try again.')).toBeVisible();

  // Focus went to the FIRST invalid field, which is named, invalid and described by its error.
  await expect(focused(page)).toHaveAttribute('id', 'title');
  await expect(page.locator('input#title')).toHaveAttribute('aria-invalid', 'true');
  const describedBy = await page.locator('input#title').getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`[id="${describedBy}"]`)).not.toBeEmpty();
  await expect(page.locator('input#slug')).toHaveValue(slug); // what was typed survives
  await expectAccessible(page, 'document editor with server validation errors');

  // --- correct the title, then pick the required author with the keyboard -----------------------
  await page.keyboard.type(title);
  await page.locator('input#author').focus();
  await page.keyboard.type('admin@tiny');
  await page.keyboard.press('Enter'); // from the search box to the first result
  const result = page.getByRole('button', { name: /admin@tiny\.e2e\.test/ });
  await expect(result).toBeFocused();
  await expectAccessible(page, 'relation picker with results');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Choose another/ })).toBeFocused();

  // The selection can be removed by keyboard too, and chosen again.
  const removeAuthor = page.getByRole('button', {
    name: /^Remove .* from Author$/
  });
  await removeAuthor.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('input#author')).toBeFocused();
  await page.keyboard.type('admin@tiny');
  await page.keyboard.press('Enter');
  await expect(result).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: /^Choose another/ })).toBeFocused();

  // --- save (Enter in a field), publish, edit ---------------------------------------------------
  await page.locator('input#title').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/collections\/posts$/);
  await expect(row()).toBeVisible();
  await expectAccessible(page, 'collection workspace');

  await row()
    .getByRole('button', { name: /^Publish/ })
    .focus();
  await page.keyboard.press('Enter');
  await expect(row().getByText('Published', { exact: true })).toBeVisible();

  const editButton = row().getByRole('button', { name: /^Edit/ });
  await editButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('input#title')).toHaveValue(title);
  await expect(focused(page)).toHaveAttribute('id', 'title');

  // --- unsaved changes: an accessible dialog, Stay keeps everything, Leave lets go --------------
  await page.keyboard.type(' (edited)');
  const leave = page.getByRole('dialog', { name: 'Leave without saving?' });
  await page.keyboard.press('Escape'); // Escape on the editor asks to leave
  await expect(leave).toBeVisible();
  await expect(leave.getByRole('button', { name: 'Stay' })).toBeFocused();
  await expectAccessible(page, 'unsaved-changes confirmation dialog');
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Tab');
    expect(
      await focusIsWithin(page, '[aria-labelledby="forge-confirm-dialog-title"]'),
      `Tab #${i + 1} stayed in the confirmation`
    ).toBe(true);
  }
  await leave.getByRole('button', { name: 'Stay' }).focus();
  await page.keyboard.press('Enter');
  await expect(leave).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin\/collections\/posts\/[^/]+$/);
  await expect(page.locator('input#title')).toHaveValue(`${title} (edited)`);
  await expect(page.locator('input#title')).toBeFocused(); // back where the editor pressed Escape

  const cancel = page.locator(dialog).getByRole('button', { name: 'Cancel' });
  await cancel.focus();
  await page.keyboard.press('Enter');
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Leave without saving' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/collections\/posts$/);
  await expect(row()).toBeVisible();
  await expect(row().getByRole('button', { name: /^Edit/ })).toBeFocused(); // what opened the editor
  await expect(page.locator('volt-table-row', { hasText: `${title} (edited)` })).toHaveCount(0);

  // --- delete: Cancel returns focus; Confirm removes the row and focus lands on the heading -----
  const deleteButton = row().getByRole('button', { name: /^Delete/ });
  await deleteButton.focus();
  await page.keyboard.press('Enter');
  const confirm = page.getByRole('dialog', { name: 'Delete this document?' });
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expectAccessible(page, 'delete confirmation dialog');
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(deleteButton).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(confirm.getByRole('button', { name: 'Delete' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(row()).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Posts', level: 1 })).toBeFocused();

  // --- sign out ---------------------------------------------------------------------------------
  const logoutButton = page.getByRole('button', { name: /log out/i });
  await logoutButton.focus();
  await page.keyboard.press('Enter');
  await page.waitForURL('**/admin/login**');
});

test('U02 (spec 086): sign-in, the content list and the users workspace have no WCAG AA violations', async ({
  page
}) => {
  await page.goto('/admin/login');
  await hydrated(page);
  await expectAccessible(page, 'sign in');

  // A failed attempt: announced, and focus is somewhere usable.
  await page.locator('input#forge-signin-email').fill(ADMIN_EMAIL);
  await page.locator('input#forge-signin-password').fill('definitely-wrong');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('input#forge-signin-password')).toBeFocused();
  await expectAccessible(page, 'sign in with an error');

  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectAccessible(page, 'collections index');

  await page.goto('/admin/collections/posts');
  await hydrated(page);
  await expect(page.locator('volt-table-row').nth(1)).toBeVisible();
  await expectAccessible(page, 'collection workspace');

  await page.goto('/admin/users');
  await hydrated(page);
  await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
  await expect(page.locator('volt-table-row').nth(1)).toBeVisible();
  await expectAccessible(page, 'users workspace');

  await page.getByRole('button', { name: 'New User' }).click();
  await expect(page.locator('input#forge-user-name')).toBeFocused();
  await expectAccessible(page, 'users workspace with the user form open');
});

test('U02 (spec 086): the empty editor and its error state have no WCAG AA violations', async ({
  page
}) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto('/admin/collections/posts/new');
  await hydrated(page);
  await expectAccessible(page, 'document editor');

  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Fix the highlighted fields and try again.')).toBeVisible();
  await expect(page.locator('input#title')).toBeFocused();
  await expectAccessible(page, 'document editor with errors');
});
test('U01 (spec 085): a session that ends mid-edit is rejected by the real server and the unsaved edit stays on screen', async ({
  page,
  context
}) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto('/admin/collections/posts');
  await hydrated(page);
  await page
    .locator('volt-table-row')
    .filter({ has: page.getByRole('button', { name: /^Edit/ }) })
    .first()
    .getByRole('button', { name: /^Edit/ })
    .click();
  await expect(page.locator('input#title')).not.toHaveValue('');
  await page.locator('input#title').fill('Edited as the session ends');

  // Another tab signs this account out (same cookie jar, real server-side logout).
  const other = await context.newPage();
  const loggedOut = await other.request.post('/api/auth/logout', { headers: SAME_ORIGIN_HEADERS });
  expect(loggedOut.ok()).toBe(true);
  await other.close();

  const writes: number[] = [];
  page.on('response', (response) => {
    if (response.request().method() === 'PUT') writes.push(response.status());
  });
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText(/session expired/i).first()).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/collections\/posts\/[^/]+$/);
  await expect(page.locator('input#title')).toHaveValue('Edited as the session ends');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(writes).toEqual([401]);
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
    .filter({ has: page.getByRole('button', { name: /^Edit/ }) })
    .first();
  await anyRow.getByRole('button', { name: /^Edit/ }).click();
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

  // Spec 061: the generic content API cannot bypass what the dedicated routes just enforced. Same
  // session, same-origin, and an admin (so collection access would allow it) — refused because the
  // users collection is managed by the auth adapter, not because of CSRF, role or the last-admin
  // check. Reads on the same collection keep working and never expose auth-owned fields.
  const jsonHeaders = { 'content-type': 'application/json', ...SAME_ORIGIN_HEADERS };
  const genericAttempts = [
    await page.request.put(`/api/v1/users/${adminId}`, {
      data: { role: 'viewer' },
      headers: jsonHeaders
    }),
    await page.request.delete(`/api/v1/users/${adminId}`, { headers: SAME_ORIGIN_HEADERS }),
    await page.request.post('/api/v1/users', {
      data: { email: 'rogue@tiny.e2e.test', role: 'admin' },
      headers: jsonHeaders
    })
  ];
  for (const attempt of genericAttempts) {
    expect(attempt.status()).toBe(403);
    const body = (await attempt.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('AUTH_MANAGED_COLLECTION');
    expect(body.error.message).toContain('managed by the configured auth adapter');
  }
  const usersRead = await page.request.get('/api/v1/users');
  expect(usersRead.status()).toBe(200);
  const usersBody = (await usersRead.json()) as { data: Record<string, unknown>[] };
  expect(usersBody.data.some((user) => user['id'] === adminId)).toBe(true);
  for (const user of usersBody.data) {
    expect(user).not.toHaveProperty('passwordHash');
    expect(user).not.toHaveProperty('_sessionVersion');
  }

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
  await hydrated(page);
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

// Spec 069 (H04): public signup is a public endpoint, so an attacker talks HTTP, not the UI. An admin
// exists by now (bootstrapped above) — so this is the escalation case, not the legitimate first-admin
// bootstrap, which is the only way a signup becomes admin.
test('H04: a signup smuggling role/roles/_sessionVersion/passwordHash becomes a plain viewer', async ({
  request
}) => {
  const email = `mallory-${Date.now()}@tiny.e2e.test`;
  const signup = await request.post('/api/auth/signup', {
    data: {
      email,
      password: 'mallory-password-123',
      role: 'admin',
      roles: ['admin'],
      _sessionVersion: 999,
      passwordHash: 'If6Zrfe0K5ZTX4epnsGKhynqsYCtSnGguaNkxiFer_SRG6SLXF5NOPToEpHbPR5J',
      id: 'chosen-id'
    },
    headers: { 'content-type': 'application/json' }
  });
  expect(signup.status()).toBe(201);
  const created = (await signup.json()) as { data: { user: Record<string, unknown> } };
  expect(created.data.user['role']).toBe('viewer');
  expect(created.data.user['id']).not.toBe('chosen-id');
  for (const field of ['roles', 'passwordHash', '_sessionVersion']) {
    expect(created.data.user).not.toHaveProperty(field);
  }

  // The session the cookie carries is live (so `_sessionVersion` was not taken from the body) and is
  // a viewer's: user management stays out of reach.
  const me = await request.get('/api/auth/me');
  expect(((await me.json()) as { data: { role: string } }).data.role).toBe('viewer');
  const users = await request.get('/api/auth/users');
  expect(users.status()).toBe(403);

  // The submitted password — not the smuggled hash — is the account's password.
  const login = await request.post('/api/auth/login', {
    data: { email, password: 'mallory-password-123' },
    headers: { 'content-type': 'application/json' }
  });
  expect(login.status()).toBe(200);
});

test('H04: auth bodies are bounded and login failures do not reveal accounts', async ({
  request
}) => {
  const oversized = await request.post('/api/auth/login', {
    data: JSON.stringify({ email: ADMIN_EMAIL, password: 'x'.repeat(20_000) }),
    headers: { 'content-type': 'application/json' }
  });
  expect(oversized.status()).toBe(413);
  expect(await oversized.json()).toEqual({
    error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' }
  });

  const malformed = await request.post('/api/auth/login', {
    data: '{not json',
    headers: { 'content-type': 'application/json' }
  });
  expect(malformed.status()).toBe(400);
  expect(((await malformed.json()) as { error: { code: string } }).error.code).toBe(
    'INVALID_INPUT'
  );

  const attempt = async (email: string) => {
    const response = await request.post('/api/auth/login', {
      data: { email, password: 'definitely-wrong-password' },
      headers: { 'content-type': 'application/json' }
    });
    return { status: response.status(), body: await response.text() };
  };
  const unknown = await attempt('nobody@tiny.e2e.test');
  expect(unknown).toEqual(await attempt(ADMIN_EMAIL));
  expect(unknown.status).toBe(401);
});

test('H04: admin user routes authenticate before reading a bounded body; logout is CSRF-checked', async ({
  page,
  request
}) => {
  const anonymous = await request.post('/api/auth/users', {
    data: JSON.stringify({ email: 'x@tiny.e2e.test', password: 'y'.repeat(20_000) }),
    headers: { 'content-type': 'application/json' }
  });
  expect(anonymous.status()).toBe(401);

  // The first admin was demoted by the last-admin test above; the second admin is the admin now.
  await loginAs(page, SECOND_ADMIN_EMAIL, SECOND_ADMIN_PASSWORD);
  const oversized = await page.request.post('/api/auth/users', {
    data: JSON.stringify({ email: 'x@tiny.e2e.test', password: 'y'.repeat(20_000) }),
    headers: { 'content-type': 'application/json', ...SAME_ORIGIN_HEADERS }
  });
  expect(oversized.status()).toBe(413);

  const tooLong = await page.request.post('/api/auth/users', {
    data: { email: `long-${Date.now()}@tiny.e2e.test`, password: 'z'.repeat(1025) },
    headers: { 'content-type': 'application/json', ...SAME_ORIGIN_HEADERS }
  });
  expect(tooLong.status()).toBe(400);

  const forgedLogout = await page.request.post('/api/auth/logout', {
    headers: { origin: 'https://evil.example' }
  });
  expect(forgedLogout.status()).toBe(403);
  // Still signed in: the forged logout changed nothing.
  expect((await page.request.get('/api/auth/me')).status()).toBe(200);
  await logout(page);
});

// The HTTP contract of `GET /api/v1/:collection`, asserted purely at the wire — it knows nothing
// about which transport wrapper serves the route, so it must pass unchanged across a transport swap.
test('read API contract (list + single document, both served by Strata): query, pagination, filter, sort, depth, errors and read access are preserved', async ({
  page,
  request
}) => {
  await loginAs(page, SECOND_ADMIN_EMAIL, SECOND_ADMIN_PASSWORD);
  const me = (await (await page.request.get('/api/auth/me')).json()) as { data: { id: string } };
  const authorId = me.data.id;

  const stamp = Date.now();
  const slugs = [`list-contract-a-${stamp}`, `list-contract-b-${stamp}`];
  for (const [index, slug] of slugs.entries()) {
    const created = await page.request.post('/api/v1/posts', {
      data: { title: `List Contract ${index === 0 ? 'A' : 'B'} ${stamp}`, slug, author: authorId },
      headers: { 'content-type': 'application/json', ...SAME_ORIGIN_HEADERS }
    });
    expect(created.status()).toBe(201);
  }

  type ListBody = {
    data: { id: string; title: string; slug: string; author: unknown }[];
    meta: Record<string, unknown>;
  };
  const list = async (query: string) => {
    const response = await page.request.get(`/api/v1/posts${query}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    return (await response.json()) as ListBody;
  };

  // Envelope.
  const all = await list('?status=all');
  expect(Object.keys(all).sort()).toEqual(['data', 'meta']);
  expect(all.meta).toMatchObject({ collection: 'posts', count: all.data.length });
  expect(all.meta['totalDocs']).toBeGreaterThanOrEqual(3);

  // Filter by field equality.
  const filtered = await list(`?status=all&slug=${slugs[0]}`);
  expect(filtered.data.map((doc) => doc.slug)).toEqual([slugs[0]]);

  // Pagination.
  const firstPage = await list('?status=all&sort=title&order=asc&limit=1&offset=0');
  const secondPage = await list('?status=all&sort=title&order=asc&limit=1&offset=1');
  expect(firstPage.data).toHaveLength(1);
  expect(firstPage.meta).toMatchObject({ limit: 1, offset: 0, count: 1, hasNextPage: true });
  expect(secondPage.meta).toMatchObject({ limit: 1, offset: 1, hasPrevPage: true });
  expect(secondPage.data[0]?.id).not.toBe(firstPage.data[0]?.id);

  // Sort order.
  const asc = (await list('?status=all&sort=title&order=asc')).data.map((doc) => doc.title);
  const desc = (await list('?status=all&sort=title&order=desc')).data.map((doc) => doc.title);
  expect(asc).toEqual([...asc].sort());
  expect(desc).toEqual([...asc].reverse());

  // Relation depth.
  const shallow = await list(`?status=all&slug=${slugs[0]}&depth=0`);
  const populated = await list(`?status=all&slug=${slugs[0]}&depth=1`);
  expect(shallow.data[0]?.author).toBe(authorId);
  expect(populated.data[0]?.author).toMatchObject({ id: authorId });

  // Error contract: invalid query and unknown collection.
  const invalid = await page.request.get('/api/v1/posts?limit=abc');
  expect(invalid.status()).toBe(400);
  expect(((await invalid.json()) as { error: { code: string } }).error.code).toBe('INVALID_QUERY');
  const unknown = await page.request.get('/api/v1/does-not-exist');
  expect(unknown.status()).toBe(404);
  expect(await unknown.json()).toEqual({
    error: { code: 'NOT_FOUND', message: "Collection 'does-not-exist' not found" }
  });

  // Read access follows the caller's credentials: drafts and auth-only collections are the
  // authenticated view; the anonymous `request` fixture carries no session cookie.
  const anonymousDrafts = await request.get(`/api/v1/posts?slug=${slugs[0]}`);
  expect(anonymousDrafts.status()).toBe(200);
  expect(((await anonymousDrafts.json()) as ListBody).data).toEqual([]);
  const anonymousUsers = await request.get('/api/v1/users');
  const authenticatedUsers = await page.request.get('/api/v1/users');
  expect(authenticatedUsers.status()).toBe(200);
  expect(anonymousUsers.status()).not.toBe(200);

  // Single document (`GET /api/v1/:collection/:id`, a Strata controller since spec 071).
  const draftDoc = filtered.data[0];
  expect(draftDoc).toBeDefined();
  const draftId = draftDoc?.id ?? '';
  const one = await page.request.get(`/api/v1/posts/${draftId}?status=all&depth=1`);
  expect(one.status()).toBe(200);
  const oneBody = (await one.json()) as { data: { id: string; author: { id: string } } };
  expect(Object.keys(oneBody)).toEqual(['data']);
  expect(oneBody.data.id).toBe(draftId);
  expect(oneBody.data.author).toMatchObject({ id: authorId });
  // The draft is invisible to an anonymous caller, and missing ids/collections are the usual 404s.
  expect((await request.get(`/api/v1/posts/${draftId}`)).status()).toBe(404);
  expect((await page.request.get('/api/v1/posts/does-not-exist')).status()).toBe(404);
  const unknownOne = await page.request.get(`/api/v1/does-not-exist/${draftId}`);
  expect(await unknownOne.json()).toEqual({
    error: { code: 'NOT_FOUND', message: "Collection 'does-not-exist' not found" }
  });
  // Mutations on the same URL are still the H3 file routes, CSRF and all.
  const renamed = await page.request.put(`/api/v1/posts/${draftId}`, {
    data: { title: `List Contract A renamed ${stamp}` },
    headers: { 'content-type': 'application/json', ...SAME_ORIGIN_HEADERS }
  });
  expect(renamed.status()).toBe(200);
  const forged = await page.request.put(`/api/v1/posts/${draftId}`, {
    data: { title: 'forged' },
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' }
  });
  expect(forged.status()).toBe(403);

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
