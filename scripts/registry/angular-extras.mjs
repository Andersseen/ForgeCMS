// Extra browser/HTTP journeys for the registry Angular/Analog consumer (roadmap L02), run against the production
// build served by the built server: session persistence, admin UI create → publish → edit → unpublish, an upload
// through the admin, anonymous refusals, responsive layout and a WCAG axe scan. Playwright and axe come from a
// first-party app that pins them (the consumer deliberately has none).
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { loadChromium, repoRoot } from '../ssr-consumer/shared.mjs';

const ADMIN = { email: 'admin@example.test', password: 'a-long-passphrase' };
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const fail = (message) => {
  throw new Error(`angular registry extras: ${message}`);
};
const expect = (condition, message) => {
  if (!condition) fail(message);
};

/**
 * The ONE excluded rule, the same one `apps/tiny-project/e2e/golden-path.spec.ts` documents (spec 086): `target-size`
 * (WCAG 2.2 · 2.5.8). The quickstart ships no stylesheet, so every control is at its browser-default size; that measures
 * the missing CSS, not the admin. The rule runs unexcluded against the styled consumer (`apps/demo-aesthetics`).
 */
const UNSTYLED_FIXTURE_EXCLUSIONS = ['target-size'];

const axeBuilder = () =>
  createRequire(join(repoRoot, 'apps', 'tiny-project', 'package.json'))('@axe-core/playwright')
    .default;

/** Records every console error / page error except the anonymous `GET /api/auth/me` 401 the guard expects. */
function watch(page, problems) {
  page.on('console', (message) => {
    if (/status of 401/.test(message.text())) return;
    if (message.type() === 'error' || /NG0\d+|JIT compiler/.test(message.text())) {
      problems.push(message.text());
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
}

async function signIn(page, origin) {
  await page.goto(`${origin}/admin/login`);
  await page.locator('#forge-signin-email').fill(ADMIN.email);
  await page.locator('#forge-signin-password').fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL(`${origin}/admin/collections`);
}

async function anonymousRefusals(origin) {
  const json = { 'content-type': 'application/json' };
  for (const [method, path] of [
    ['POST', '/api/v1/posts'],
    ['POST', '/api/v1/media'],
    ['GET', '/api/auth/me']
  ]) {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: json,
      body: method === 'POST' ? '{}' : undefined
    });
    expect(
      response.status === 401,
      `anonymous ${method} ${path} answered ${response.status}, expected 401`
    );
    const body = await response.json();
    expect(
      body?.error && typeof body.error.code === 'string',
      `anonymous ${path}: no error envelope`
    );
  }
  const posts = await (await fetch(`${origin}/api/v1/posts?status=all`)).json();
  expect(
    Array.isArray(posts.data) && posts.data.every((post) => post._status === 'published'),
    'an anonymous caller can list drafts with ?status=all'
  );
  console.log(
    '  ✓ anonymous: create/upload/me → 401 with the error envelope; ?status=all exposes no draft'
  );
}

export async function registryBrowserChecks(origin) {
  await anonymousRefusals(origin);

  const chromium = await loadChromium();
  const AxeBuilder = axeBuilder();
  const browser = await chromium.launch();
  const problems = [];
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    watch(page, problems);

    // Session persistence: HttpOnly cookie only, nothing credential-like in web storage, survives reload and a new tab.
    await signIn(page, origin);
    const cookies = await context.cookies();
    const session = cookies.find((cookie) => cookie.name === 'forge_session');
    expect(session?.httpOnly === true, 'the session cookie is not HttpOnly');
    expect(session.sameSite !== 'None', `the session cookie is SameSite=${session.sameSite}`);
    const storage = await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })
    );
    expect(
      !/forge_session|token|password/i.test(storage),
      `web storage holds credentials: ${storage}`
    );
    await page.reload();
    await page.getByText('Posts').first().waitFor();
    const second = await context.newPage();
    watch(second, problems);
    await second.goto(`${origin}/admin/collections`);
    await second.getByText('Posts').first().waitFor();
    await second.close();
    console.log(
      '  ✓ session: HttpOnly cookie, no credential in web storage, survives reload and a second tab'
    );

    // Admin UI journey: create (draft) → publish → public → edit → unpublish.
    const title = `Registry post ${Date.now()}`;
    await page.getByRole('link', { name: /^Posts/ }).click();
    await page.getByRole('button', { name: 'New' }).click();
    await page.locator('input#title').fill(title);
    await page.locator('input#author').fill('admin');
    await page.getByRole('button', { name: new RegExp(ADMIN.email.replace('.', '\\.')) }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    const row = () => page.locator('volt-table-row', { hasText: title });
    await row().waitFor();
    expect(
      (await (await fetch(`${origin}/api/v1/posts`)).json()).data.every(
        (post) => post.title !== title
      ),
      'a draft created in the admin is public'
    );
    await row()
      .getByRole('button', { name: /^Publish/ })
      .click();
    await page.waitForFunction(async (expected) => {
      const body = await (await fetch('/api/v1/posts')).json();
      return body.data.some((post) => post.title === expected);
    }, title);
    const edited = `${title} (edited)`;
    await row().getByRole('button', { name: /^Edit/ }).click();
    await page.locator('input#title').fill(edited);
    await page.getByRole('button', { name: 'Save' }).click();
    await page.locator('volt-table-row', { hasText: edited }).waitFor();
    await page
      .locator('volt-table-row', { hasText: edited })
      .getByRole('button', { name: /^Unpublish/ })
      .click();
    await page.waitForFunction(async (expected) => {
      const body = await (await fetch('/api/v1/posts')).json();
      return body.data.every((post) => post.title !== expected);
    }, edited);
    console.log(
      '  ✓ admin UI: create (draft, not public) → publish (public) → edit → unpublish (hidden)'
    );

    // Upload through the admin's upload picker (the Cover field), served back through /api/media.
    const uploadPage = await context.newPage();
    watch(uploadPage, problems);
    await uploadPage.goto(`${origin}/admin/collections/posts/new`);
    await uploadPage.locator('input[type="file"]').setInputFiles({
      name: 'registry.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('registry upload')
    });
    await uploadPage.locator('[data-forge-remove]').waitFor();
    const media = (await (await fetch(`${origin}/api/v1/media`)).json()).data;
    const uploaded = media.find((doc) => doc.filename === 'registry.txt');
    expect(uploaded, 'the admin upload picker produced no media document');
    expect(
      (await (await fetch(`${origin}${uploaded.url}`)).text()) === 'registry upload',
      'the upload did not round-trip'
    );
    await uploadPage.close({ runBeforeUnload: false });
    console.log('  ✓ admin upload picker → media document → bytes served from /api/media');

    // Accessibility: WCAG A/AA scan of the sign-in page and the main admin screens.
    const scan = async (label, path, prepare) => {
      const fresh = await context.newPage();
      watch(fresh, problems);
      await fresh.goto(`${origin}${path}`);
      await prepare?.(fresh);
      const results = await new AxeBuilder({ page: fresh })
        .withTags(WCAG_TAGS)
        .disableRules(UNSTYLED_FIXTURE_EXCLUSIONS)
        .analyze();
      await fresh.close();
      const serious = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical'
      );
      expect(
        serious.length === 0,
        `${label}: ${serious.map((v) => `${v.id} (${v.impact}, ${v.nodes.length})`).join(', ')}`
      );
      return results.violations.length;
    };
    const wait = (name) => (p) => p.getByText(name).first().waitFor();
    const counts = [
      await scan('collections', '/admin/collections', wait('Posts')),
      await scan('posts list', '/admin/collections/posts', wait('Posts')),
      await scan('new post', '/admin/collections/posts/new', wait('New document'))
    ];
    const anonymous = await (await browser.newContext()).newPage();
    watch(anonymous, problems);
    await anonymous.goto(`${origin}/admin/login`);
    await anonymous.locator('#forge-signin-email').waitFor();
    const loginResults = await new AxeBuilder({ page: anonymous })
      .withTags(WCAG_TAGS)
      .disableRules(UNSTYLED_FIXTURE_EXCLUSIONS)
      .analyze();
    await anonymous.close();
    const loginSerious = loginResults.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    );
    expect(loginSerious.length === 0, `sign-in: ${loginSerious.map((v) => v.id)}`);
    console.log(
      `  ✓ axe (WCAG 2.0–2.2 A/AA): no serious/critical violation on sign-in, collections, list, form (other: ${[...counts, loginResults.violations.length].join('/')})`
    );

    // Responsive: no horizontal overflow at phone width on the public page and the admin.
    const phone = await browser.newContext({ viewport: { width: 375, height: 667 } });
    const small = await phone.newPage();
    watch(small, problems);
    await small.goto(`${origin}/`);
    await small.waitForLoadState('networkidle');
    const overflow = async (label) => {
      const wide = await small.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(wide <= 1, `${label}: ${wide}px of horizontal overflow at 375px`);
    };
    await overflow('public page');
    await signIn(small, origin);
    await overflow('admin collections');
    await small.goto(`${origin}/admin/collections/posts/new`);
    await small.getByText('New document').waitFor();
    await overflow('admin form');
    await small.getByRole('button', { name: 'Create' }).waitFor();
    expect(
      await small.getByRole('button', { name: 'Create' }).isVisible(),
      'Create is not reachable on a phone'
    );
    await phone.close();
    console.log(
      '  ✓ responsive: no horizontal overflow at 375px (public, collections, form); Create stays reachable'
    );

    expect(problems.length === 0, `browser problems:\n${problems.join('\n')}`);
    console.log('  ✓ no console errors, page errors or NG0xxx across all journeys');
  } finally {
    await browser.close();
  }
}
