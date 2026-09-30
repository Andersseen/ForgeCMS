import { expect, test } from '@playwright/test';
import { CURRENT_FORGE_VERSION } from '../src/app/forge-release';

test('presents ForgeCMS as an Angular-native product', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Angular-native headless CMS/);
  await expect(
    page.getByRole('heading', { name: 'The Angular CMS that stays in your application.' })
  ).toBeVisible();
  await expect(page.getByText('Live content pipeline')).toBeVisible();
  await expect(page.getByText('Schema', { exact: true })).toBeVisible();
  await expect(page.getByText('Runtime', { exact: true })).toBeVisible();
  await expect(page.getByText('Admin', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Install command')).toContainText('@forge-cms/runtime');
});

test('global navigation gives Product, Demo and Docs equal routes', async ({ page }) => {
  await page.goto('/');

  const header = page.locator('header');
  await expect(header.getByRole('link', { name: 'Product', exact: true })).toHaveAttribute(
    'href',
    new RegExp('/#product$')
  );
  await expect(header.getByRole('link', { name: 'Demo', exact: true })).toHaveAttribute(
    'href',
    new RegExp('/demo$')
  );
  await expect(header.getByRole('link', { name: 'Docs', exact: true })).toHaveAttribute(
    'href',
    new RegExp('/docs$')
  );
  await expect(header.getByRole('link', { name: /GitHub/ })).toHaveAttribute(
    'href',
    'https://github.com/Andersseen/ForgeCMS'
  );
});

test('primary actions route to the guide and the first-class demo page', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'Start building' })).toHaveAttribute(
    'href',
    new RegExp('/docs/small-project-guide$')
  );
  await expect(page.getByRole('link', { name: 'Explore the live demo' })).toHaveAttribute(
    'href',
    new RegExp('/demo$')
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('link', { name: 'Explore the live demo' }).click();
  await expect(page).toHaveURL(new RegExp('/demo$'));
  await expect(
    page.getByRole('heading', { name: /Lumea is a clinic built from content/ })
  ).toBeVisible();
});

test('packages derive from the single release version', async ({ page }) => {
  await page.goto('/');

  const packages = page.locator('#packages');
  await expect(packages.getByText('@forge-cms/core', { exact: true })).toBeVisible();
  await expect(packages.getByText('@forge-cms/testing', { exact: true })).toBeVisible();
  await expect(packages.locator('volt-badge', { hasText: CURRENT_FORGE_VERSION })).toHaveCount(10);
  await expect(page.getByText('0.0.0')).toHaveCount(0);
});

test('the homepage separates shipped foundations from the next checkpoint', async ({ page }) => {
  await page.goto('/');

  const architecture = page.locator('#architecture');
  await expect(architecture.getByText('Local API, no internal HTTP')).toBeVisible();
  await expect(
    architecture.getByRole('heading', { name: /Compose content where your server code/ })
  ).toBeVisible();

  const roadmap = page.locator('#roadmap');
  await expect(roadmap.getByText('0.6', { exact: true })).toBeVisible();
  await expect(roadmap.getByText('0.7', { exact: true })).toBeVisible();
  await expect(roadmap.getByText('0.8', { exact: true })).toBeVisible();
  await expect(roadmap.getByText('0.9', { exact: true })).toHaveCount(0);
  await expect(roadmap.getByText('Reviewed migrations')).toBeVisible();
});

test('mobile navigation remains usable and the page does not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  const mobile = page.getByRole('navigation', { name: 'Mobile' });
  await expect(mobile.getByRole('link', { name: 'Product' })).toBeVisible();
  await expect(mobile.getByRole('link', { name: 'Demo' })).toBeVisible();
  await expect(mobile.getByRole('link', { name: 'Docs' })).toBeVisible();
  await expect(mobile.getByRole('link', { name: /GitHub/ })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('footer keeps the project destinations available', async ({ page }) => {
  await page.goto('/');

  const footer = page.locator('footer');
  await expect(footer.getByRole('link', { name: 'ForgeCMS' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Demo' })).toHaveAttribute(
    'href',
    new RegExp('/demo$')
  );
  await expect(footer.getByRole('link', { name: 'Docs' })).toHaveAttribute(
    'href',
    new RegExp('/docs$')
  );
  await expect(footer.getByRole('link', { name: 'npm' })).toHaveAttribute(
    'href',
    'https://www.npmjs.com/org/forge-cms'
  );
});
