import { defineConfig } from 'vitest/config';

// Spec 084 (roadmap 0.10 / P03): the real libSQL + S3 recovery rehearsal. It needs the Garage service that
// `pnpm test:s3` starts and provisions (FORGE_S3_TEST_*), so it is its own config and the `recovery` stage of
// that command — not part of the Docker-free `pnpm test:upgrade`. CI runs it; it never skips.
export default defineConfig({
  test: {
    include: ['test/s3/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 120_000
  }
});
