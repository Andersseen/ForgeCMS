import { defineConfig } from 'vitest/config';

// Restores, explicitly, the include pattern `vitest run --dir .` used implicitly when this file
// did not exist — kept narrow to `src/` so the real-Workers-runtime suite under `test/workers/`
// (its own project, `vitest.workers.config.ts`, run via `pnpm test:cloudflare`) is never swept
// into this package's default `test`/`test:watch` scripts.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts']
  }
});
