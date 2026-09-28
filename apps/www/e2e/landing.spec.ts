import { expect, test } from '@playwright/test';
import { CURRENT_FORGE_VERSION } from '../src/app/forge-release';

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
  await expect(packages.getByText('@forge-cms/testing', { exact: true })).toBeVisible();
  // Every card shows the one current version (src/app/forge-release.ts), and nothing stale.
  await expect(packages.locator('volt-badge', { hasText: CURRENT_FORGE_VERSION })).toHaveCount(10);
  await expect(page.getByText(/\b0\.4\.\d/)).toHaveCount(0);
  await expect(page.getByText('0.0.0')).toHaveCount(0);

  const footer = page.locator('footer');
  await expect(footer.getByRole('link', { name: 'ForgeCMS' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', /\/docs$/);
  await expect(footer.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/Andersseen/ForgeCMS'
  );
  await expect(footer.getByRole('link', { name: 'npm' })).toHaveAttribute(
    'href',
    'https://www.npmjs.com/org/forge-cms'
  );
});

test('the landing answers what works today, the Local API, and what remains', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText(/Experimental · pre-1\.0/)).toBeVisible();
  await expect(page.getByLabel('Install command')).toContainText('@forge-cms/runtime');

  const architecture = page.locator('#architecture');
  await expect(architecture.getByText('Local API, no internal HTTP')).toBeVisible();
  await expect(architecture.getByRole('heading', { name: /What "Local API" means/ })).toBeVisible();

  const roadmap = page.locator('#roadmap');
  await expect(roadmap.getByText('0.6 — Auth and data integrity')).toBeVisible();
  await expect(roadmap.getByText('0.7 — Upgrade safety')).toBeVisible();
  await expect(roadmap.getByText('In progress')).toBeVisible();
  await expect(roadmap.getByText('Reviewed migrations')).toBeVisible();
  await roadmap.getByRole('link', { name: 'How schema upgrades work today' }).click();
  await expect(page).toHaveURL(/\/docs\/schema-upgrades$/);
  await expect(page.getByRole('heading', { name: 'Schema upgrades', level: 1 })).toBeVisible();
});

test('the demo dialog opens, points at the real demo, and closes with Escape', async ({ page }) => {
  await page.goto('/');

  await page
    .getByRole('button', { name: 'See the clinic demo powered by the real runtime' })
    .click();
  const dialog = page.getByRole('dialog', { name: /Lumea Aesthetics/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();

  await expect(dialog.getByRole('link', { name: 'Open the demo site →' })).toHaveAttribute(
    'href',
    'https://forge-cms-demo.pages.dev'
  );
  await expect(dialog.getByRole('link', { name: 'Go straight to the CMS' })).toHaveAttribute(
    'href',
    'https://forge-cms-demo.pages.dev/login'
  );

  await dialog.getByRole('button', { name: "I'm an Angular developer" }).click();
  await expect(dialog.getByRole('link', { name: 'Read the content model →' })).toHaveAttribute(
    'href',
    /github\.com\/Andersseen\/ForgeCMS\/tree\/main\/apps\/demo-aesthetics$/
  );

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // The close button works too.
  await page
    .getByRole('button', { name: 'See the clinic demo powered by the real runtime' })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});
