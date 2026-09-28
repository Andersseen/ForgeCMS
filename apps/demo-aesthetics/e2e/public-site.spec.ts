import { expect, test } from '@playwright/test';
import { useOwnThrottleBucket } from './visitor';

useOwnThrottleBucket('public-site');

test('public site journey: home, treatment detail, booking CTA', async ({ page }) => {
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
});

test('public site journey: journal list, a post, and its date', async ({ page }) => {
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
