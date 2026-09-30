import { expect, test } from '@playwright/test';
import { useOwnThrottleBucket } from './visitor';
import { guardConsole } from './console-guard';

useOwnThrottleBucket('public-site');

test('a failed CMS request gives visitors a retry and a route back to the demo guide', async ({
  page
}) => {
  const problems = guardConsole(page, { allowFailedResources: true });
  let attempts = 0;
  await page.route('**/api/site/home', async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"error":{"code":"INTERNAL","message":"raw server detail"}}'
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/');

  await expect(page.getByText("We couldn't load this content.")).toBeVisible();
  await expect(page.getByText('raw server detail')).toHaveCount(0);
  await expect(page.getByText(/\/api\/site|500/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /ForgeCMS demo guide/ })).toHaveAttribute(
    'href',
    'https://forge-cms.pages.dev/demo'
  );

  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('link', { name: 'Treatments' }).first()).toBeVisible();
  expect(attempts).toBe(2);
  expect(problems).toEqual([]);
});

for (const { path, api, subject } of [
  { path: '/services', api: '**/api/site/services', subject: 'The treatment menu' },
  { path: '/team', api: '**/api/site/team', subject: 'The team' },
  { path: '/journal', api: '**/api/site/journal', subject: 'The journal' }
]) {
  test(`${path}: a backend outage shows the retry state, never raw text or a spinner`, async ({
    page
  }) => {
    const problems = guardConsole(page, { allowFailedResources: true });
    let attempts = 0;
    await page.route(api, async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({ status: 503, contentType: 'text/html', body: '<h1>upstream</h1>' });
        return;
      }
      await route.continue();
    });

    await page.goto(path);
    await expect(page.getByText(`${subject} is unavailable`)).toBeVisible();
    await expect(page.getByText(/Loading/)).toHaveCount(0);
    await expect(page.getByText('upstream')).toHaveCount(0);

    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText(`${subject} is unavailable`)).toHaveCount(0);
    expect(attempts).toBe(2);
    expect(problems).toEqual([]);
  });
}

test('a network failure on a detail page is an outage, not "not found"', async ({ page }) => {
  const problems = guardConsole(page, { allowFailedResources: true });
  await page.route('**/api/site/services/signature-hydraglow-facial', (route) => route.abort());
  await page.goto('/services/signature-hydraglow-facial');
  await expect(page.getByText('This treatment is unavailable')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'We could not find that treatment' })).toHaveCount(
    0
  );
  expect(problems.filter((p) => !p.includes('ERR_FAILED'))).toEqual([]);
});

test('a 500 on a journal entry is an outage, not "not published"', async ({ page }) => {
  guardConsole(page, { allowFailedResources: true });
  await page.route('**/api/site/journal/*', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  );
  await page.goto('/journal/any-entry');
  await expect(page.getByText('This journal entry is unavailable')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'That entry is not published' })).toHaveCount(0);
});

test('public site journey: home, treatment detail, booking CTA', async ({ page }) => {
  const problems = guardConsole(page);
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'Treatments' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Treatments' }).first().click();
  await expect(page).toHaveURL(/\/services$/);
  await expect(page.getByRole('heading', { name: 'Treatments', level: 1 })).toBeVisible();

  await page.getByRole('link', { name: /Signature HydraGlow facial/i }).click();
  await expect(page).toHaveURL(/\/services\/signature-hydraglow-facial$/);
  await expect(page.getByRole('heading', { name: /Signature HydraGlow facial/i })).toBeVisible();

  await page.getByRole('link', { name: 'Request this treatment' }).click();
  await expect(page).toHaveURL(/\/booking\?service=signature-hydraglow-facial$/);
  await expect(page.getByRole('heading', { name: /Request an appointment/i })).toBeVisible();
  expect(problems).toEqual([]);
});

test('public site journey: journal list, a post, and its date', async ({ page }) => {
  const problems = guardConsole(page);
  await page.goto('/journal');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // `routerLink` renders an absolute href.
  const firstPost = page.locator('a[href*="/journal/"]').first();
  const title = (await firstPost.locator('h2, h3').first().textContent())?.trim() ?? '';
  expect(title).not.toBe('');
  await firstPost.click();

  await expect(page).toHaveURL(/\/journal\/[^/]+$/);
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  // `publishedAt` renders as a date (it was blank whenever the adapter returned a Date — finding 24).
  await expect(page.getByText(/\b(19|20)\d{2}\b · \d+ min read/)).toBeVisible();
  expect(problems).toEqual([]);
});

test('an unknown treatment is a not-found state, not a crash', async ({ page, request }) => {
  const api = await request.get('/api/site/services/no-such-treatment');
  expect(api.status()).toBe(404);

  await page.goto('/services/no-such-treatment');
  await expect(
    page.getByRole('heading', { name: 'We could not find that treatment', level: 1 })
  ).toBeVisible();
});

test('public mobile navigation exposes the main sections', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.getByText('Menu', { exact: true }).click();

  const mobileNav = page.getByLabel('Mobile navigation');
  await expect(mobileNav.getByRole('link', { name: 'Treatments' })).toBeVisible();
  await expect(mobileNav.getByRole('link', { name: 'Team' })).toBeVisible();
  await expect(mobileNav.getByRole('link', { name: 'Journal' })).toBeVisible();
});

test('public site resets the admin dark theme when staff exits', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('forgecms-theme', 'dark');
    document.documentElement.classList.add('dark');
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const themeState = await page.evaluate(() => ({
    darkClass: document.documentElement.classList.contains('dark'),
    colorScheme: document.documentElement.style.colorScheme,
    bodyColor: getComputedStyle(document.body).color
  }));

  expect(themeState).toEqual({
    darkClass: false,
    colorScheme: 'light',
    bodyColor: 'oklch(0.2 0.02 155)'
  });
});
