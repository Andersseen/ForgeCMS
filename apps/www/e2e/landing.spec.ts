import { expect, test } from '@playwright/test';

test('renders the ForgeCMS landing page', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/ForgeCMS/);
  await expect(page.getByRole('heading', { name: /Payload-like CMS path/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /ForgeCMS/i })).toBeVisible();
  await expect(page.getByRole('link', { name: 'GitHub' })).toBeVisible();
  await expect(page.getByText('@forge-cms/core', { exact: true })).toBeVisible();
});

test('navigation anchors work', async ({ page }) => {
  await page.goto('/');

  const architectureLink = page.getByRole('link', { name: /Architecture/i });
  await expect(architectureLink).toBeVisible();
  await expect(architectureLink).toHaveAttribute('href', '#architecture');

  const packagesLink = page.getByRole('link', { name: /Packages/i });
  await expect(packagesLink).toBeVisible();
  await expect(packagesLink).toHaveAttribute('href', '#packages');

  const roadmapLink = page.getByRole('link', { name: /Roadmap/i });
  await expect(roadmapLink).toBeVisible();
  await expect(roadmapLink).toHaveAttribute('href', '#roadmap');
});

test('CTA buttons are visible and enabled', async ({ page }) => {
  await page.goto('/');

  const exploreButton = page.getByRole('button', { name: 'Explore architecture' });
  await expect(exploreButton).toBeVisible();
  await expect(exploreButton).toBeEnabled();

  const viewButton = page.getByRole('button', { name: 'View packages' });
  await expect(viewButton).toBeVisible();
  await expect(viewButton).toBeEnabled();
});
