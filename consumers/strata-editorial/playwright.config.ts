import { defineConfig, devices } from '@playwright/test';

// Real Chromium against the BUILT production server (not `vite` dev). Retries are OFF: a flaky result is a
// finding, not something to retry away.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    [
      'json',
      { outputFile: `qualification/artifacts/e2e-${process.env['E2E_TARGET'] ?? 'node'}.json` }
    ]
  ],
  use: { baseURL: 'http://127.0.0.1:4610', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // E2E_TARGET=workerd runs the SAME suite on the Cloudflare Pages build under local workerd + local D1.
  webServer: {
    command:
      process.env['E2E_TARGET'] === 'workerd'
        ? 'node --experimental-strip-types e2e/serve-workerd.ts'
        : 'node --experimental-strip-types e2e/serve.ts',
    url: 'http://127.0.0.1:4610/api/health',
    reuseExistingServer: false,
    timeout: 120_000
  }
});
