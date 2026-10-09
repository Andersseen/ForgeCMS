import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { useOwnThrottleBucket } from './visitor';

useOwnThrottleBucket('admin-content');

const DEMO_EMAIL = 'demo@lumea.clinic';
const DEMO_PASSWORD = 'lumea-demo';

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input#email').fill(DEMO_EMAIL);
  await page.locator('input#password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/admin');
}

/**
 * The editor journey the landing's demo dialog promises: a treatment written as a draft is invisible
 * on the public site, and one click on Publish in the package's list (`forgeAdminContentRoutes()`,
 * spec 052) puts it there — visible on the next load in the same browser.
 */
test('content: create a draft treatment, publish it from the list, see it on the site', async ({
  page,
  request
}) => {
  const name = `E2E treatment ${Date.now()}`;
  await signIn(page);

  // The sidebar links into the package's content routes.
  await page.getByRole('link', { name: 'Treatments' }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/services$/);

  await page.getByRole('button', { name: 'New' }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/services\/new$/);
  await page.locator('#name').fill(name);
  await page.locator('#summary').fill('Created by the end-to-end suite.');
  await page.locator('#durationMinutes').fill('30');
  await page.locator('#price').fill('40');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/services$/);

  const row = page.locator('volt-table-row', { hasText: name });
  await expect(row.getByText('Draft', { exact: true })).toBeVisible();

  // A visitor does not see the draft — not in the page, not in its API payload.
  await page.goto('/services');
  await expect(page.getByRole('heading', { name: 'Treatments', level: 1 })).toBeVisible();
  await expect(page.getByText(name)).toHaveCount(0);
  const before = await request.get('/api/site/services');
  expect(await before.text()).not.toContain(name);

  await page.goto('/admin/collections/services');
  await page
    .locator('volt-table-row', { hasText: name })
    .getByRole('button', { name: /^Publish/ })
    .click();
  await expect(
    page.locator('volt-table-row', { hasText: name }).getByText('Published', { exact: true })
  ).toBeVisible();

  // Same browser, straight after publishing: the site shows it.
  await page.goto('/services');
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
});

test('the booking a visitor sends arrives in the staff inbox as pending', async ({ page }) => {
  const visitor = `E2E visitor ${Date.now()}`;

  await page.goto('/booking');
  await page.locator('input[name="name"]').fill(visitor);
  await page.locator('input[name="email"]').fill('e2e-visitor@example.com');
  await page.locator('input[name="preferredDate"]').fill('2030-05-14T10:30');
  await page
    .locator('select[name="service"]')
    .selectOption({ label: 'Signature HydraGlow facial' });
  await page.getByRole('button', { name: /send|request/i }).click();
  await expect(page.getByRole('heading', { name: 'Request received' })).toBeVisible();

  await signIn(page);
  await page.goto('/admin/collections/bookings');
  const row = page.locator('volt-table-row', { hasText: visitor });
  await expect(row).toBeVisible();
  // The treatment column shows the service's name, not its id (the list populates relations).
  await expect(row.getByText('Signature HydraGlow facial')).toBeVisible();

  // The status the hook forced, read with the staff session.
  const stored = await page.request.get(`/api/v1/bookings?name=${encodeURIComponent(visitor)}`);
  const body = (await stored.json()) as { data: { status: string }[] };
  expect(body.data.map((booking) => booking.status)).toEqual(['pending']);
});

test('the admin works at phone width: lists scroll in place, controls have names', async ({
  page
}) => {
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });

  for (const path of [
    '/admin/collections/services',
    '/admin/collections/bookings',
    '/admin/users'
  ]) {
    await page.goto(path);
    await expect(page.locator('volt-table').first()).toBeVisible();
    // A wide table scrolls inside its own container; the page itself never scrolls sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow, path).toBe(0);
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/admin/settings');
  await expect(page.getByRole('switch', { name: 'Closed' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Toggle sidebar' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Switch to (dark|light) mode/ })).toBeVisible();
});
