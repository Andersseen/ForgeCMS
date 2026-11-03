import { expect, test, type Page } from '@playwright/test';

/**
 * Spec 101: the localized public site under the production build (workerd + prerendered HTML) —
 * translated HTML before JavaScript, honest alternates, redirects and 404s at the HTTP boundary,
 * hydration without a second catalog fetch, and the language switcher.
 */

const ORIGIN = 'https://forgecms.dev';

const HEADINGS: Record<string, string> = {
  '/': 'Your content.',
  '/es': 'Tu contenido.',
  '/uk': 'Ваш контент.',
  '/demo': 'Lumea is a clinic built from content',
  '/es/demo': 'Lumea es una clínica construida con contenido',
  '/uk/demo': 'Lumea — клініка, створена з контенту',
  '/privacy': 'Website audience measurement',
  '/es/privacy': 'Medición de audiencia del sitio web',
  '/uk/privacy': 'Вимірювання аудиторії сайту',
  '/es/docs/introduction': 'Introducción',
  '/uk/docs/quickstart': 'Швидкий старт',
  '/es/docs/small-project-guide': 'Guía para un proyecto pequeño'
};

function localeOf(path: string): 'en' | 'es' | 'uk' {
  if (path === '/es' || path.startsWith('/es/')) return 'es';
  if (path === '/uk' || path.startsWith('/uk/')) return 'uk';
  return 'en';
}

function consoleProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    const text = message.text();
    // The anonymous session probe (`/api/auth/me` → 401) is how "nobody is signed in" is answered.
    if (text.includes('status of 401') && message.location().url.endsWith('/api/auth/me')) return;
    problems.push(`${message.type()}: ${text}`);
  });
  page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
  return problems;
}

test('localized pages are translated in the HTTP HTML, with lang, canonical and alternates', async ({
  browser
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  for (const [path, heading] of Object.entries(HEADINGS)) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    const locale = localeOf(path);
    await expect(page.locator('html'), path).toHaveAttribute('lang', locale);
    await expect(page.locator('h1').first(), path).toContainText(heading);
    await expect(page.locator('link[rel="canonical"]'), path).toHaveAttribute(
      'href',
      `${ORIGIN}${path}`
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      'content',
      `${ORIGIN}${path}`
    );
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
      'content',
      { en: 'en_US', es: 'es_ES', uk: 'uk_UA' }[locale]
    );
    const alternates = await page
      .locator('link[rel="alternate"][hreflang]')
      .evaluateAll((links) =>
        links.map((l) => [l.getAttribute('hreflang'), l.getAttribute('href')])
      );
    expect(
      alternates.map(([hreflang]) => hreflang),
      path
    ).toEqual(['en', 'es', 'uk', 'x-default']);
    const english = alternates.find(([hreflang]) => hreflang === 'x-default')?.[1];
    expect(english, path).toBe(alternates.find(([hreflang]) => hreflang === 'en')?.[1]);
  }
  await context.close();
});

test('the Spanish landing page has no English UI copy before JavaScript', async ({ request }) => {
  const html = await (await request.get('/es')).text();
  for (const english of [
    'Start building',
    'Explore the live demo',
    'Everything between your schema',
    'Why ForgeCMS',
    'Read the full roadmap',
    'Your next project starts with your content'
  ]) {
    expect(html, english).not.toContain(english);
  }
  expect(html).toContain('Empezar a construir');
  // Experimental features stay labelled as such in every language.
  expect(html).toContain('Experimental');
  expect(await (await request.get('/uk')).text()).toContain('Експериментально');
});

test('an English-only article has no alternates and no localized URL', async ({ request }) => {
  const html = await (await request.get('/docs/fields')).text();
  expect(html).not.toContain('hreflang=');
  expect(html).toContain(`href="${ORIGIN}/docs/fields"`);
  for (const path of ['/es/docs/fields', '/uk/docs/hooks']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
  }
});

test('unknown locales and unknown localized docs are real 404s', async ({ request }) => {
  for (const path of ['/fr', '/fr/demo', '/es/docs/not-a-real-article', '/de/docs/quickstart']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
    expect(await response.text(), path).toContain('name="robots" content="noindex, nofollow"');
  }
});

test('/en is never a duplicate: it redirects to the unprefixed URL', async ({ request }) => {
  for (const [from, to] of [
    ['/en', '/'],
    ['/en/demo', '/demo'],
    ['/en/docs/quickstart', '/docs/quickstart']
  ] as const) {
    const response = await request.get(from, { maxRedirects: 0 });
    expect(response.status(), from).toBe(301);
    expect(new URL(response.headers().location ?? '', 'http://x').pathname, from).toBe(to);
  }
  for (const locale of ['es', 'uk']) {
    const response = await request.get(`/${locale}/docs`, { maxRedirects: 0 });
    expect(response.status()).toBe(301);
    expect(response.headers().location).toBe(`/${locale}/docs/introduction`);
  }
});

test('the sitemap lists only real translations, with alternates', async ({ request }) => {
  const xml = await (await request.get('/sitemap.xml')).text();
  expect(xml).toContain(`<loc>${ORIGIN}/es/docs/quickstart</loc>`);
  expect(xml).not.toContain(`${ORIGIN}/es/docs/fields`);
  expect(xml).not.toMatch(/\/en(\/|<|")/);
  expect(xml).not.toMatch(/\/(admin|api)\//);
  const landing = xml.slice(xml.indexOf(`<loc>${ORIGIN}/uk</loc>`));
  expect(landing.slice(0, landing.indexOf('</url>'))).toContain(
    `<xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}/"/>`
  );
});

test('hydration reuses the transferred catalog: Spanish stays Spanish, no second fetch', async ({
  page
}) => {
  const problems = consoleProblems(page);
  const catalogChunks: string[] = [];
  page.on('request', (request) => {
    if (/\/assets\/(es|uk)-[\w-]+\.js$/.test(new URL(request.url()).pathname)) {
      catalogChunks.push(request.url());
    }
  });
  await page.goto('/es');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('h1').first()).toContainText('Tu contenido.');
  await expect(page.getByRole('link', { name: 'Empezar a construir' })).toBeVisible();
  expect(catalogChunks).toEqual([]);
  expect(problems).toEqual([]);
});

test('client navigation keeps the locale, the head and a single canonical in sync', async ({
  page
}) => {
  await page.goto('/uk');
  await page
    .getByRole('navigation', { name: 'Основна' })
    .getByRole('link', { name: 'Демо' })
    .click();
  await expect(page).toHaveURL(/\/uk\/demo$/);
  await expect(page).toHaveTitle('Демо — ForgeCMS');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${ORIGIN}/uk/demo`);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(4);
  await page.goBack();
  await expect(page).toHaveURL(/\/uk$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
});

test('the language switcher keeps the page, query and fragment, and history works', async ({
  page
}) => {
  await page.goto('/demo?ref=switcher#explore-title');
  const trigger = page.getByRole('button', { name: 'Language: English' });
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Українська' }).click();
  await expect(page).toHaveURL(/\/uk\/demo\?ref=switcher#explore-title$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
  await expect(page.locator('h1')).toContainText('Lumea — клініка');
  await page.goBack();
  await expect(page).toHaveURL(/\/demo\?ref=switcher#explore-title$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('the switcher is keyboard operable and marks the current language', async ({ page }) => {
  await page.goto('/es/privacy');
  const trigger = page.getByRole('button', { name: 'Idioma: Español' });
  // The menu primitive attaches its listeners on hydration; its collapsed state proves it is live.
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.focus();
  await page.keyboard.press('Enter');
  const current = page.getByRole('menuitem', { name: 'Español' });
  await expect(current).toHaveAttribute('aria-current', 'true');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'English' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Website audience measurement'
  );
});

test('from an English-only article the switcher falls back deliberately to the docs home', async ({
  page
}) => {
  await page.goto('/docs/fields');
  await page.getByRole('button', { name: 'Language: English' }).click();
  const spanish = page.getByRole('menuitem', { name: /Español/ });
  await expect(spanish).toContainText('Not translated yet');
  await spanish.click();
  await expect(page).toHaveURL(/\/es\/docs\/introduction$/);
  await expect(page.locator('h1')).toContainText('Introducción');
});

test('localized docs link translated articles in-locale and the rest to English', async ({
  page
}) => {
  await page.goto('/es/docs/introduction');
  await page.waitForLoadState('networkidle');
  // Compare paths: an `href` may be serialized relative (prerender) or absolute (after hydration).
  const pathOf = (href: string | null) => new URL(href ?? '', page.url()).pathname;
  const sidebar = page.getByRole('complementary', { name: 'Documentación' });
  const quickstart = sidebar.getByRole('link', { name: /^Inicio rápido/ });
  expect(pathOf(await quickstart.getAttribute('href'))).toBe('/es/docs/quickstart');
  const fields = sidebar.getByRole('link', { name: /Fields/ });
  expect(pathOf(await fields.getAttribute('href'))).toBe('/docs/fields');
  await expect(fields).toContainText('EN');
  const paths = (
    await page.$$eval('a[href]', (links) => links.map((a) => (a as HTMLAnchorElement).href))
  )
    .map((href) => new URL(href))
    .filter((url) => url.origin === new URL(page.url()).origin)
    .map((url) => url.pathname)
    .filter((path) => path.startsWith('/es/docs/'));
  expect(paths.length).toBeGreaterThan(0);
  for (const path of paths) {
    expect(path, 'no localized link without a translation').toMatch(
      /^\/es\/docs\/(introduction|quickstart|small-project-guide)\/?$/
    );
  }
  await expect(page.getByRole('heading', { level: 2, name: 'Qué funciona hoy' })).toBeVisible();
});

test('the theme survives a language switch', async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');
  const dark = (await html.getAttribute('class'))?.includes('dark') ?? false;
  await page
    .getByRole('button', { name: dark ? 'Switch to light mode' : 'Switch to dark mode' })
    .click();
  await page.getByRole('button', { name: 'Language: English' }).click();
  await page.getByRole('menuitem', { name: 'Español' }).click();
  await expect(page).toHaveURL(/\/es$/);
  if (dark) await expect(html).not.toHaveClass(/dark/);
  else await expect(html).toHaveClass(/dark/);
});

for (const width of [390, 768, 1440, 1920]) {
  test(`localized routes fit ${width}px without overflow or console errors`, async ({ page }) => {
    const problems = consoleProblems(page);
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/es', '/uk', '/uk/demo', '/es/privacy', '/uk/docs/small-project-guide']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const { overflow, culprits } = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        // Name what sticks out, so a font-dependent failure on CI explains itself.
        culprits: Array.from(document.querySelectorAll('body *'))
          .filter((el) => {
            const box = el.getBoundingClientRect();
            return (
              box.width > 0 &&
              box.right > innerWidth + 1 &&
              !el.closest('pre, [data-scroll-x], table')
            );
          })
          .slice(0, 4)
          .map(
            (el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 40)}"`
          )
      }));
      expect(overflow, `${path} @ ${width}px: ${culprits.join(', ')}`).toBeLessThanOrEqual(0);
    }
    expect(problems).toEqual([]);
  });
}
