import { expect, test } from '@playwright/test';

test('renders the ForgeCMS landing page', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/ForgeCMS/);
  await expect(page.getByRole('heading', { name: /Payload-like CMS path/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /ForgeCMS/i }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'GitHub' }).first()).toBeVisible();
  await expect(page.getByText('@forge-cms/core', { exact: true })).toBeVisible();
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

  const demoButton = page.getByRole('button', { name: 'See a real site on ForgeCMS' });
  await expect(demoButton).toBeVisible();
  await expect(demoButton).toBeEnabled();

  await expect(page.getByRole('link', { name: 'Read the docs' })).toHaveAttribute(
    'href',
    /\/docs$/
  );

  const exploreButton = page.getByRole('button', { name: 'Explore architecture' });
  await expect(exploreButton).toBeVisible();
  await expect(exploreButton).toBeEnabled();
});
