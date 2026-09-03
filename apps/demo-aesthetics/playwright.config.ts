import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : '50%',
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    // The dev server, not `vite preview` — the auth/admin flow exercises the real `/api/*` h3 routes.
    // `FORGE_ENABLE_SIGNUP=1` turns on the otherwise-disabled `/api/auth/signup` route (spec 054 §7)
    // for this dedicated e2e run only — never set on the real deployed demo.
    command: 'pnpm --filter @forge-cms/demo-aesthetics dev',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { FORGE_ENABLE_SIGNUP: '1' }
  }
});
