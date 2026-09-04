import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// The real-local-Cloudflare-runtime lifecycle proof for this fixture (spec 055 §4/§22): a real D1
// binding via Miniflare/workerd, no account/credentials/remote resources. Mirrors
// packages/cloudflare/vitest.workers.config.ts's convention — a separate project from the default
// `test`/`test:watch` scripts, its own CI step (`pnpm test:cloudflare`).
export default defineConfig({
  test: {
    include: ['test/workers/**/*.test.ts']
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.test.jsonc' }
    })
  ]
});
