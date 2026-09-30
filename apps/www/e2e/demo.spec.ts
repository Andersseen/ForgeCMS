import { expect, test } from '@playwright/test';

test('the demo guide is directly loadable and shows both journeys', async ({ page }) => {
  await page.goto('/demo');

  await expect(
    page.getByRole('heading', { name: /Lumea is a clinic built from content/ })
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'See it as an editor' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Inspect it as an Angular developer' })
  ).toBeVisible();
  await expect(page.getByText('Look at the clinic site first')).toBeVisible();
  await expect(page.getByText('The content model is one TypeScript file')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the demo guide exposes the live destinations, credentials and source', async ({ page }) => {
  await page.goto('/demo');

  await expect(page.getByRole('link', { name: /Open the clinic/ })).toHaveAttribute(
    'href',
    'https://forge-cms-demo.pages.dev'
  );
  await expect(page.getByRole('link', { name: 'Sign in to the CMS' })).toHaveAttribute(
    'href',
    'https://forge-cms-demo.pages.dev/login'
  );
  await expect(page.getByText('demo@lumea.clinic / lumea-demo')).toBeVisible();
  await expect(page.getByText('frontdesk@lumea.clinic / lumea-desk')).toBeVisible();
  await expect(page.getByRole('link', { name: /Browse the demo source/ })).toHaveAttribute(
    'href',
    /github\.com\/Andersseen\/ForgeCMS\/tree\/main\/apps\/demo-aesthetics$/
  );
});

test('the demo guide stacks without horizontal overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo');

  await expect(page.getByRole('heading', { name: 'See it as an editor' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Inspect it as an Angular developer' })
  ).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
