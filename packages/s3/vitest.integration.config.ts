import { defineConfig } from 'vitest/config';

// Real S3-compatible service tests. Run through `pnpm test:s3` (scripts/test-s3.mjs), which owns the
// Garage container and injects FORGE_S3_TEST_* — never part of the package's default `test` script.
export default defineConfig({
  test: {
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
});
