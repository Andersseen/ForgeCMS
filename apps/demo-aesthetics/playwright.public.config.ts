import { defineConfig, devices } from '@playwright/test';

/**
 * The shared public demo profile (spec 098): the same app with `FORGE_PUBLIC_DEMO=1`, on its own
 * port so it never collides with the full-demo run. Serial, because the daily budget is shared state
 * and the last test deliberately spends it. No Cloudflare account is involved: the budget runs in
 * memory when there is no D1 binding.
 */
export default defineConfig({
  testDir: './e2e-public',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  failOnFlakyTests: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: { baseURL: 'http://127.0.0.1:5175', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @forge-cms/demo-aesthetics exec vite --host 127.0.0.1 --port 5175',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { FORGE_PUBLIC_DEMO: '1' }
  }
});
