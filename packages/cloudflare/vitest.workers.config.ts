import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// The real-local-Cloudflare-runtime integration suite (spec 051): D1 and R2 bindings via Miniflare
// inside actual workerd, no account/credentials/remote resources. Deliberately a separate project
// from `vitest.config.ts` (the default `test`/`test:watch` scripts) — this pool is slower and needs
// its own named CI step (`pnpm test:cloudflare`), not folded into the fast unit-test run.
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
