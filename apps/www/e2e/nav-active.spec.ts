import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const primary = (page: Page) => page.getByRole('navigation', { name: 'Primary' });

test('the primary nav marks the current section, including nested docs pages', async ({ page }) => {
  await page.goto('/docs/introduction');
  await expect(primary(page).getByRole('link', { name: 'Docs' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  await expect(primary(page).getByRole('link', { name: 'Demo' })).not.toHaveAttribute(
    'aria-current',
    'page'
  );

  await page.goto('/demo');
  await expect(primary(page).getByRole('link', { name: 'Demo' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  await expect(primary(page).getByRole('link', { name: 'Docs' })).not.toHaveAttribute(
    'aria-current',
    'page'
  );
});

test('Product is active on the landing page (with and without #product) and only there', async ({
  page
}) => {
  const product = primary(page).getByRole('link', { name: 'Product' });
  await page.goto('/');
  await expect(product).toHaveAttribute('aria-current', 'page');
  await page.goto('/#product');
  await expect(product).toHaveAttribute('aria-current', 'page');
  await page.goto('/demo');
  await expect(product).not.toHaveAttribute('aria-current', 'page');
});
