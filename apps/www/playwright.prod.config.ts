import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

/**
 * Spec 075: the official site under its **production build**, served by workerd exactly as Pages runs
 * it (`wrangler pages dev` over `dist/analog/public`, the root wrangler.toml's D1 binding kept in a
 * throwaway local state directory). A production build refuses to start without a 32-byte
 * `AUTH_SECRET`, so a random one is generated per run for this localhost server only.
 *
 *   pnpm build:www && pnpm --filter @forge-cms/www e2e:prod
 */
const port = 4173;
const secret = randomBytes(48).toString('base64');
const state = `.wrangler/e2e-prod-${Date.now()}`;

export default defineConfig({
  testDir: './e2e-prod',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    cwd: '../..',
    command:
      `pnpm exec wrangler pages dev apps/www/dist/analog/public --ip 127.0.0.1 --port ${port} ` +
      `--persist-to ${state} --binding AUTH_SECRET=${secret} --show-interactive-dev-session=false`,
    url: `http://127.0.0.1:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
