import { defineConfig } from 'vitest/config';

// `pnpm test`: the fast, deterministic fixture checks only (dataset shape, determinism, call counts).
// The timing measurements run through `pnpm test:performance` (vitest.performance.config.ts).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
});
