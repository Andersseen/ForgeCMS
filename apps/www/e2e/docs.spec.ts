import { expect, test } from '@playwright/test';

/**
 * The `/docs` markdown pipeline runs at **build time** (Analog's content plugin: marked + Prism), so
 * a unit test cannot cover it — a broken plugin config produces raw markdown, unhighlighted code, or
 * an empty page, all of which typecheck and lint fine. These assertions are the only thing standing
 * between that and a shipped docs site full of literal asterisks. See docs/specs/043.
 */

test('/docs redirects to the introduction and renders the sidebar', async ({ page }) => {
  await page.goto('/docs');
  await page.waitForURL('**/docs/introduction');

  await expect(page.getByRole('heading', { name: 'Introduction', level: 1 })).toBeVisible();

  const sidebar = page.locator('aside');
  await expect(sidebar.getByRole('link', { name: 'Quickstart', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Small project guide' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Local API' })).toBeVisible();
});

test('markdown is rendered as HTML with syntax-highlighted code', async ({ page }) => {
  await page.goto('/docs/fields');

  const prose = page.locator('.forge-prose');
  await expect(prose.locator('table')).not.toHaveCount(0);
  // Prism ran: a fenced block was tokenised rather than dumped as plain text.
  await expect(prose.locator('pre code .token').first()).toBeVisible();
  await expect(prose).not.toContainText('```');
});

test('generics inside inline code survive rendering', async ({ page }) => {
  // Analog's own codespan renderer emits inline code unescaped, so `Foo<Bar>` reaches the DOM as a
  // literal tag and disappears. vite-plugins/escape-codespans.ts fixes it; this proves it stayed fixed.
  await page.goto('/docs/adapters');

  await expect(page.locator('.forge-prose')).toContainText('DatabaseAdapter<TRecord');
});

test('navigating between pages swaps the article and updates the title', async ({ page }) => {
  await page.goto('/docs/introduction');

  await page.locator('aside').getByRole('link', { name: 'Core concepts' }).click();
  await page.waitForURL('**/docs/concepts');

  await expect(page.getByRole('heading', { name: 'Core concepts', level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(/Core concepts/);
});

test('the mobile header exposes navigation behind a hamburger', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs/introduction');

  const nav = page.locator('#site-mobile-nav');
  await expect(nav).toBeHidden();

  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(nav.getByRole('link', { name: 'Docs' })).toBeVisible();
});

test('the schema-upgrades page is in the sidebar and states availability and limits honestly', async ({
  page
}) => {
  await page.goto('/docs/introduction');
  await page.locator('aside').getByRole('link', { name: 'Schema upgrades' }).click();
  await page.waitForURL('**/docs/schema-upgrades');

  const prose = page.locator('.forge-prose');
  await expect(prose).toContainText('planSchema');
  await expect(prose).toContainText('SchemaDriftError');
  await expect(prose).toContainText('runMigrations');
  await expect(prose).toContainText(
    'reviewed migrations (`runtime.runMigrations()`) from `0.8.1`'.replaceAll('`', '')
  );
  await expect(prose).toContainText('backed up and restored into an empty environment');
  await expect(prose).toContainText('No down migrations');
  await expect(prose).toContainText('never at application startup');
});

test('the Agent Kit page leads with the one-command install and keeps the manual route', async ({
  page
}) => {
  await page.goto('/docs/agent-kit');

  const prose = page.locator('.forge-prose');
  await expect(
    page.getByRole('heading', { name: 'Agent Kit (experimental)', level: 1 })
  ).toBeVisible();
  await expect(prose.getByRole('heading', { name: 'Connect your agent', level: 2 })).toBeVisible();
  await expect(prose).toContainText('pnpm exec forge-cms-agent init');
  await expect(prose).toContainText('forge-cms-agent check');
  await expect(prose.getByRole('heading', { name: 'Manual setup' })).toBeVisible();
  // No Prism-escaped TOML/JSON dumped as raw markdown, and the Codex snippet is shown, not written.
  await expect(prose).toContainText('[mcp_servers.forge-cms]');
  await expect(prose).not.toContainText('```');
});
