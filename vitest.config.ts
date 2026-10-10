import { defineConfig } from 'vitest/config';

// Vitest finds this file from any package that has no config of its own (core, db, auth, storage, s3, api,
// runtime, angular, testing), so its `include` decides what `pnpm test` runs there — in particular it keeps
// `packages/s3/test/*.integration.test.ts` (needs the Garage service: `pnpm test:s3`) out of the default run.
//
// It carries NO coverage settings. Coverage is per package, source-attributed and gated by class floors:
// `pnpm test:coverage` (scripts/quality/, spec 089). The old B04 global thresholds that lived here were a
// ratchet below a 2026-09-18 measurement, not the 1.0 contract, and could not run the Angular suites.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts']
  }
});
