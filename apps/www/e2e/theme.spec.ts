import { expect, test } from '@playwright/test';

for (const mode of ['light', 'dark'] as const) {
  test(`${mode} theme is consistent across Home, Demo and Docs and survives reload`, async ({
    page
  }) => {
    await page.addInitScript((theme) => localStorage.setItem('forgecms-theme', theme), mode);
    await page.goto('/');
    const label = mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    const background = mode === 'dark' ? 'rgb(10, 15, 26)' : 'rgb(247, 249, 252)';
    await page.getByRole('tab', { name: 'Content', exact: true }).click();
    expect(
      await page
        .locator('.forge-content-view')
        .evaluate((el) => getComputedStyle(el).backgroundColor)
    ).toBe(mode === 'dark' ? 'rgb(17, 26, 43)' : 'rgb(255, 255, 255)');
    for (const destination of ['Product', 'Demo', 'Docs']) {
      await page
        .locator('.forge-header')
        .getByRole('link', { name: destination, exact: true })
        .click();
      await expect(page.getByRole('button', { name: label })).toBeVisible();
      await expect(page.locator('html')).toHaveClass(mode === 'dark' ? /dark/ : /^(?!.*dark).*$/);
      await expect
        .poll(() =>
          page.locator('.forge-public').evaluate((el) => getComputedStyle(el).backgroundColor)
        )
        .toBe(background);
      expect(
        await page.locator('.forge-header').evaluate((el) => getComputedStyle(el).backgroundColor)
      ).toBe(background);
      await page.reload();
      await expect(page.getByRole('button', { name: label })).toBeVisible();
    }
  });
}

test('theme toggle persists through navigation and a fresh page load', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  expect(await page.evaluate(() => localStorage.getItem('forgecms-theme'))).toBe('dark');
  await page.locator('.forge-header').getByRole('link', { name: 'Demo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await page.locator('.forge-header').getByRole('link', { name: 'Docs', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch to dark mode' })).toBeVisible();
});

test('system theme changes apply until an explicit user choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/docs/introduction');
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.getByRole('button', { name: 'Switch to dark mode' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
});

test('invalid stored preference falls back to the system', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('forgecms-theme', 'invalid'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/demo');
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
});

test('blocked storage still allows switching and navigation', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get: () => {
        throw new Error('Blocked');
      }
    });
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.locator('.forge-header').getByRole('link', { name: 'Demo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
});

test('mobile theme control is available without opening navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page
    .getByRole('navigation', { name: 'Mobile' })
    .getByRole('link', { name: 'Docs', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  ).toBeLessThanOrEqual(1);
});

test('saved theme is applied before Angular starts', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('forgecms-theme', 'dark'));
  await page.route('**/src/main.ts', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await page.locator('html').evaluate((el) => el.style.colorScheme)).toBe('dark');
});
