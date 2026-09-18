import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Scoped to the published `packages/*` surface — the actual distributable artifact this repo
      // ships — rather than `apps/*`, which are demos/fixtures/the maintainer's own consumer apps and
      // already run their own test suites under `pnpm test` regardless of this gate (spec 058 §12).
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/dist/**'],
      // Thresholds sit a few points below the measured baseline (2026-09-18, `pnpm exec vitest run
      // --coverage` at the repo root: 66.8% statements / 70.3% branches / 59.4% functions / 67.3%
      // lines) so a real regression — an unimported new module, a deleted test file, a large untested
      // addition — fails this gate, without chasing a vanity percentage. Two honest caveats, not
      // papered over: (1) `packages/testing/src/contracts/*.ts` reports near 0% here even though its
      // functions run constantly (every adapter's own test file calls
      // `runDatabaseAdapterContractTests`/etc.) — cross-package execution through the built
      // `@forge-cms/testing/dist` entry point does not attribute back to this `include` glob's `src`
      // path the way same-package execution does; this is a known reporting-attribution gap in this
      // lightweight setup, not evidence those functions are untested. (2) `packages/admin`'s UI
      // components are a known, pre-existing coverage gap (AUDIT.md finding F17) this hardening pass
      // does not fix — admin UI testing infrastructure is out of scope here (see docs/specs/058 §12).
      thresholds: {
        statements: 60,
        branches: 64,
        functions: 50,
        lines: 60
      }
    }
  }
});
