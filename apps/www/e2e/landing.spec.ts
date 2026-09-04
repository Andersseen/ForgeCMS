import { expect, test } from '@playwright/test';

test('renders the ForgeCMS landing page', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/ForgeCMS/);
  await expect(
    page.getByRole('heading', { name: /headless CMS built for Angular/i })
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /ForgeCMS/i }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'GitHub' }).first()).toBeVisible();
  await expect(page.getByText('collections / posts', { exact: true })).toBeVisible();
});

test('the header links to docs', async ({ page }) => {
  // The header used to carry #architecture/#packages/#roadmap anchors into this page. They were
  // dead weight in a global header and broken on every other route, so the nav is just Docs.
  await page.goto('/');

  // `routerLink` renders an absolute href, so match the path rather than the whole URL.
  const header = page.locator('header');
  await expect(header.getByRole('link', { name: 'Docs', exact: true })).toHaveAttribute(
    'href',
    /\/docs$/
  );
  await expect(header.getByRole('button', { name: 'GitHub' })).toBeVisible();
});

test('CTA buttons are visible and enabled', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'Get started' })).toHaveAttribute(
    'href',
    /\/docs\/small-project-guide$/
  );

  await expect(page.getByRole('link', { name: 'View docs' })).toHaveCount(0);

  const demoButton = page.getByRole('button', {
    name: 'See the clinic demo powered by the real runtime'
  });
  await expect(demoButton).toBeVisible();
  await expect(demoButton).toBeEnabled();
});

test('the homepage get-started path reaches the small-project guide', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('link', { name: 'Get started' }).click();

  await expect(page).toHaveURL(/\/docs\/small-project-guide$/);
  await expect(page.getByRole('heading', { name: 'Small project guide', level: 1 })).toBeVisible();
});

test('package versions and footer are real homepage content', async ({ page }) => {
  await page.goto('/');

  const packages = page.locator('#packages');
  await expect(packages.getByText('@forge-cms/core', { exact: true })).toBeVisible();
  await expect(page.getByText('0.4.0').first()).toBeVisible();
  await expect(page.getByText('0.0.0')).toHaveCount(0);

  const footer = page.locator('footer');
  await expect(footer.getByRole('link', { name: 'ForgeCMS' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', /\/docs$/);
  await expect(footer.getByRole('link', { name: 'GitHub' })).toBeVisible();
});
