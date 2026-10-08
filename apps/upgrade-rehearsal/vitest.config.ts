import { defineConfig } from 'vitest/config';

// Spec 073 (roadmap 0.7 M03). The rehearsal files share nothing at runtime — every test builds its
// own temporary databases, buckets and Wrangler state — but each spawns Wrangler/workerd, so they run
// one file at a time to keep the machine (and CI) from oversubscribing.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Needs the Garage service: run by `pnpm test:s3 recovery` (spec 084), never silently skipped.
    exclude: ['test/s3/**', '**/node_modules/**'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000
  }
});
