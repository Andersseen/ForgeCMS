import { expect, test } from '@playwright/test';

test('renders the ForgeCMS landing page', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/ForgeCMS/);
  await expect(page.getByRole('heading', { name: /Payload-like CMS path/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /ForgeCMS/i })).toBeVisible();
  await expect(page.getByRole('link', { name: 'GitHub' })).toBeVisible();
  await expect(page.getByText('@forge-cms/core', { exact: true })).toBeVisible();
});

test('keeps Volt UI buttons styled', async ({ page }) => {
  await page.goto('/');

  const button = page.getByRole('button', { name: 'Explore architecture' });
  await expect(button).toBeVisible();
  await expect(button).toHaveCSS('display', 'inline-flex');
  await expect(button).toHaveCSS('cursor', 'pointer');
});
