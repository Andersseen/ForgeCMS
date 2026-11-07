import { expect, test } from '@playwright/test';
import type { BrowserContext, Page, Route } from '@playwright/test';

import { CANARIES, EDITORS } from '../scripts/fixture';

/** Holds every same-origin script until `release()`, so the test can act on the server HTML first. */
async function holdScripts(page: Page): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/assets\/.*\.js$|\/src\/.*\.ts$/, async (route: Route) => {
    await gate;
    await route.continue();
  });
  return release;
}

const hydration = (page: Page) =>
  page.waitForFunction(
    () =>
      (
        (globalThis as { __editorialHydration?: { outcome: string }[] }).__editorialHydration ?? []
      ).some((o) => o.outcome === 'committed'),
    undefined,
    { timeout: 15_000 }
  );

async function signIn(context: BrowserContext, who: keyof typeof EDITORS): Promise<void> {
  const response = await context.request.post('/api/account/login', {
    data: { email: EDITORS[who].email, password: EDITORS[who].password },
    headers: { origin: 'http://127.0.0.1:4610' }
  });
  expect(response.status()).toBe(200);
}

function trackConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    // 404 documents log the failed resource load; that is the expected status, not an application error.
    if (message.type() === 'error' && !/status of 404/.test(message.text()))
      errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('direct deep link: server HTML is complete, then the SAME DOM hydrates and the island works', async ({
  page
}) => {
  const errors = trackConsole(page);
  const release = await holdScripts(page);
  const response = await page.goto('/posts/welcome-to-the-desk', { waitUntil: 'commit' });
  expect(response?.status()).toBe(200);
  await page.locator('#post h1').waitFor();
  await expect(page.locator('#post h1')).toHaveText('Welcome to the desk');
  await expect(page.locator('[data-byline]')).toHaveText('By Ana Ortega');
  // Tag the server-rendered nodes before any script runs.
  await page.evaluate(() => {
    (globalThis as Record<string, unknown>)['__ssrArticle'] = document.querySelector('#post');
    (globalThis as Record<string, unknown>)['__ssrButton'] =
      document.querySelector('[data-reading-size]');
  });
  release();
  await hydration(page);
  const reused = await page.evaluate(
    () =>
      document.querySelector('#post') === (globalThis as Record<string, unknown>)['__ssrArticle'] &&
      document.querySelector('[data-reading-size]') ===
        (globalThis as Record<string, unknown>)['__ssrButton']
  );
  expect(reused, 'hydration must reuse the server DOM, not re-render it').toBe(true);
  await page.locator('[data-reading-size]').click();
  await expect(page.locator('[data-reading-size]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-reader-text-size', 'large');
  expect(errors).toEqual([]);
});

test('JavaScript disabled: the post is readable, a protected draft is a 404', async ({
  browser
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const ok = await page.goto('/posts/ben-published-column');
  expect(ok?.status()).toBe(200);
  await expect(page.locator('#post h1')).toHaveText('On local newsrooms');
  const reload = await page.reload();
  expect(reload?.status()).toBe(200);
  const hidden = await page.goto('/posts/ben-draft-column');
  expect(hidden?.status()).toBe(404);
  await expect(page.locator('#post-not-found')).toBeVisible();
  expect(await page.content()).not.toContain(CANARIES.benDraft);
  await context.close();
});

test('a click queued BEFORE hydration is replayed exactly once', async ({ page }) => {
  const release = await holdScripts(page);
  await page.goto('/posts/welcome-to-the-desk', { waitUntil: 'commit' });
  await page.locator('[data-reading-size]').waitFor();
  await page.locator('[data-reading-size]').click();
  release();
  await hydration(page);
  // One toggle, replayed once: pressed. A double replay would toggle back to false.
  await expect(page.locator('[data-reading-size]')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(300);
  await expect(page.locator('[data-reading-size]')).toHaveAttribute('aria-pressed', 'true');
});

test('editor workflow: own draft, one request per action (incl. before hydration), anonymous sees result', async ({
  browser
}) => {
  const editor = await browser.newContext();
  await signIn(editor, 'ana');
  const page = await editor.newPage();
  const errors = trackConsole(page);
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/status')) posts.push(request.url());
  });

  // Queued before hydration: Publish.
  const release = await holdScripts(page);
  await page.goto('/posts/ana-draft-investigation', { waitUntil: 'commit' });
  await page.locator('[data-review-toggle]').waitFor();
  await expect(page.locator('[data-draft-badge]')).toBeVisible();
  expect(await page.content()).toContain(CANARIES.anaDraft);
  await page.locator('[data-review-toggle]').click();
  release();
  await hydration(page);
  await expect(page.locator('[data-review-result]')).toHaveText('Published.');
  await expect(page.locator('[data-review-status]')).toHaveAttribute('data-status', 'published');
  expect(posts).toHaveLength(1);

  const anonymous = await browser.newContext();
  const reader = await anonymous.newPage();
  expect((await reader.goto('/posts/ana-draft-investigation'))?.status()).toBe(200);

  // After hydration: Unpublish, exactly one more request.
  await page.locator('[data-review-toggle]').click();
  await expect(page.locator('[data-review-result]')).toHaveText('Moved back to draft.');
  expect(posts).toHaveLength(2);
  expect((await reader.goto('/posts/ana-draft-investigation'))?.status()).toBe(404);
  expect(errors).toEqual([]);
  await anonymous.close();
  await editor.close();
});

test('service failure during an action: safe message, nothing changed, then recovery', async ({
  browser
}) => {
  const editor = await browser.newContext();
  await signIn(editor, 'ana');
  const page = await editor.newPage();
  await page.goto('/posts/ana-draft-investigation');
  await hydration(page);
  await page.route('**/api/editorial/posts/*/status', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: '{"error":"Internal server error"}'
    })
  );
  await page.locator('[data-review-toggle]').click();
  await expect(page.locator('[data-review-result]')).toHaveText(
    'Could not update the post (500). Nothing was changed.'
  );
  await expect(page.locator('[data-review-status]')).toHaveAttribute('data-status', 'draft');
  await page.unroute('**/api/editorial/posts/*/status');
  await page.locator('[data-review-toggle]').click();
  await expect(page.locator('[data-review-status]')).toHaveAttribute('data-status', 'published');
  await page.locator('[data-review-toggle]').click();
  await expect(page.locator('[data-review-status]')).toHaveAttribute('data-status', 'draft');
  await editor.close();
});

test('cross-user: Ben gets the same 404 page for Ana’s draft; his browser never receives it', async ({
  browser
}) => {
  const context = await browser.newContext();
  await signIn(context, 'ben');
  const page = await context.newPage();
  const bodies: string[] = [];
  page.on('response', async (response) => {
    if (response.request().resourceType() !== 'image')
      bodies.push(await response.text().catch(() => ''));
  });
  expect((await page.goto('/posts/ana-draft-investigation'))?.status()).toBe(404);
  await expect(page.locator('#post-not-found')).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(bodies.some((body) => body.includes(CANARIES.anaDraft))).toBe(false);
  await context.close();
});

test('navigation: conventional route → Server Component route is a document load; history works', async ({
  page
}) => {
  const errors = trackConsole(page);
  await page.goto('/');
  await expect(page.locator('[data-desk-list] a').first()).toBeVisible();
  await page.evaluate(() => ((globalThis as Record<string, unknown>)['__sameDocument'] = true));
  const navigation = page.waitForResponse(
    (r) =>
      r.url().endsWith('/posts/welcome-to-the-desk') && r.request().resourceType() === 'document'
  );
  await page.getByRole('link', { name: 'Welcome to the desk' }).click();
  expect((await navigation).status()).toBe(200);
  await expect(page.locator('#post h1')).toHaveText('Welcome to the desk');
  expect(
    await page.evaluate(() => (globalThis as Record<string, unknown>)['__sameDocument'])
  ).toBeUndefined();

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#desk h1')).toHaveText('Editorial desk');
  await page.goForward();
  await expect(page).toHaveURL(/\/posts\/welcome-to-the-desk$/);
  await expect(page.locator('#post h1')).toHaveText('Welcome to the desk');
  await page.reload();
  await expect(page.locator('#post h1')).toHaveText('Welcome to the desk');

  // Back to the conventional desk through the document link in the Server Component route.
  await page.locator('[data-home-link]').click();
  await expect(page.locator('#desk h1')).toHaveText('Editorial desk');
  expect(errors).toEqual([]);
});

test('sign-in from a conventional page returns to the requested post by document navigation', async ({
  page
}) => {
  await page.goto('/login?returnTo=/posts/ana-draft-investigation');
  await page.locator('input[name=email]').fill(EDITORS.ana.email);
  await page.locator('input[name=password]').fill(EDITORS.ana.password);
  const landed = page.waitForResponse(
    (r) =>
      r.url().endsWith('/posts/ana-draft-investigation') &&
      r.request().resourceType() === 'document'
  );
  await page.locator('[data-login-submit]').click();
  expect((await landed).status()).toBe(200);
  await expect(page.locator('[data-draft-badge]')).toBeVisible();
});

test('open redirect refused; unknown pages and API paths are 404', async ({ page, request }) => {
  await page.goto('/login?returnTo=https://evil.example/');
  await page.locator('input[name=email]').fill(EDITORS.vic.email);
  await page.locator('input[name=password]').fill(EDITORS.vic.password);
  await page.locator('[data-login-submit]').click();
  await expect(page).toHaveURL('http://127.0.0.1:4610/');
  expect((await page.goto('/definitely/missing'))?.status()).toBe(404);
  const api = await request.get('/api/editorial/unknown');
  expect(api.status()).toBe(404);
  expect(api.headers()['content-type']).toContain('json');
});
