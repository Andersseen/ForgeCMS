import { expect, test, type Page } from '@playwright/test';

/**
 * Spec 075: the official site's public surface under the production build — health, layout at the
 * four audited widths, console, navigation, keyboard focus, reduced motion, metadata and links.
 * Not a pixel test.
 */

const WIDTHS = [390, 768, 1440, 1920];
const ROUTES = [
  '/',
  '/demo',
  '/docs/introduction',
  '/docs/quickstart',
  '/docs/schema-upgrades',
  '/admin/login'
];

/**
 * Unexpected console errors, uncaught exceptions and unhandled rejections. One allowlisted line,
 * proven harmless: Chromium's network log for the anonymous session check `GET /api/auth/me` → 401,
 * which is exactly how "nobody is signed in" is answered (spec 075).
 */
function guardConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const anonymousSessionCheck =
      text.startsWith('Failed to load resource') &&
      text.includes('status of 401') &&
      message.location().url.endsWith('/api/auth/me');
    if (!anonymousSessionCheck) problems.push(`console.error: ${text}`);
  });
  page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
  return problems;
}

/** Text-bearing elements whose box ends past the viewport — clipped content `scrollWidth` cannot see. */
async function clippedElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return Array.from(document.querySelectorAll('h1, h2, h3, p, a, button, code, label, input, li'))
      .filter((el) => {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return false;
        if (el.closest('pre, [data-scroll-x], table, .overflow-x-auto')) return false;
        return box.right > width + 1;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 40)}"`);
  });
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
}

test('the production API starts and reports its adapters', async ({ request }) => {
  const response = await request.get('/api/status');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { data: { api: { status: string } } };
  expect(body.data.api.status).toBe('online');
  expect((await request.get('/api/v1/collections')).status()).toBe(200);
});

for (const width of WIDTHS) {
  test(`every public route fits ${width}px without console errors`, async ({ page }) => {
    const problems = guardConsole(page);
    await page.setViewportSize({ width, height: 900 });
    for (const route of ROUTES) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).not.toBeEmpty();
      expect(await horizontalOverflow(page), `${route} at ${width}px`).toBeLessThanOrEqual(0);
      expect(await clippedElements(page), `${route} at ${width}px`).toEqual([]);
    }
    expect(problems).toEqual([]);
  });
}

test('the admin shell redirects an anonymous visitor to sign-in', async ({ page }) => {
  const problems = guardConsole(page);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  expect(problems).toEqual([]);
});

test('primary navigation works on desktop and in the mobile menu', async ({ page }) => {
  await page.goto('/');
  const header = page.locator('header');
  await header.getByRole('link', { name: 'Demo', exact: true }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await header.getByRole('link', { name: 'Docs', exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/introduction$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  const demo = page.getByRole('navigation', { name: 'Mobile' }).getByRole('link', { name: 'Demo' });
  await expect(demo).toBeVisible();
  await demo.click();
  await expect(page).toHaveURL(/\/demo$/);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('keyboard focus reaches the header controls and is visible', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.locator('header').getByRole('link', { name: 'Docs', exact: true })
  ).toBeVisible();
  const seen: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const visible =
        (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
        style.boxShadow !== 'none';
      return { name: (el.textContent ?? el.getAttribute('aria-label') ?? '').trim(), visible };
    });
    if (focused) {
      expect(focused.visible, `focus ring on "${focused.name}"`).toBe(true);
      seen.push(focused.name);
    }
  }
  expect(seen.some((name) => /Docs/.test(name))).toBe(true);
});

test('reduced motion renders the pipeline statically', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  const problems = guardConsole(page);
  await page.goto('/');
  await expect(page.getByText('Live content pipeline')).toBeVisible();
  const running = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity)
        .length
  );
  expect(running).toBe(0);
  expect(problems).toEqual([]);
  await context.close();
});

test('shared-link metadata is present and follows the route', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    'content',
    /width=device-width/
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Local API/);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /ForgeCMS/);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://forge-cms.pages.dev/'
  );

  await page.goto('/docs/quickstart');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://forge-cms.pages.dev/docs/quickstart'
  );
  await expect(page).toHaveTitle(/ForgeCMS docs/);
  await page.goto('/demo');
  await expect(page).toHaveTitle('Demo — ForgeCMS');
});

test('no first-party internal link is dead', async ({ page, request }) => {
  const internal = new Set<string>();
  const external = new Set<string>();
  for (const route of ['/', '/demo', '/docs/introduction']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const hrefs = await page.$$eval('a[href]', (links) =>
      links.map((a) => (a as HTMLAnchorElement).href)
    );
    for (const href of hrefs) {
      const url = new URL(href);
      if (url.origin === new URL(page.url()).origin) internal.add(url.pathname);
      else external.add(url.origin + url.pathname);
    }
  }
  // Docs articles are client-rendered from content files: load each link as a page and require a
  // real article (a dead slug renders no h1) instead of trusting the SPA's 200.
  for (const path of internal) {
    if (path.startsWith('/docs/')) {
      await page.goto(path);
      await expect(page.locator('h1').first(), path).toBeVisible();
    } else {
      expect((await request.get(path)).status(), path).toBe(200);
    }
  }
  expect([...internal]).toEqual(
    expect.arrayContaining(['/demo', '/docs/schema-upgrades', '/docs/quickstart'])
  );
  expect([...external]).toEqual(
    expect.arrayContaining([
      'https://github.com/Andersseen/ForgeCMS',
      'https://forge-cms-demo.pages.dev/'
    ])
  );
});
