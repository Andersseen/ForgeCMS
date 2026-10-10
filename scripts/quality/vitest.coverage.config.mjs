// Per-package Vitest config used ONLY by `pnpm test:coverage` (scripts/quality/coverage-release.mjs).
//
// It loads the package's own `vitest.config.ts` (so admin keeps its Angular compile transform and
// cloudflare keeps its `src/`-only include), then layers on the coverage settings that make the
// numbers honest (spec 089):
//   - scope = the source the package build ships: `src/**/*.ts` minus tests and `*.test-helpers.ts`
//     (which `tsconfig.build.json` also excludes);
//   - `@forge-cms/testing` resolves to its SOURCE, so the adapter contract suites that db/auth/storage/
//     runtime/cloudflare run are attributed to `packages/testing/src/contracts/*` instead of an
//     un-attributable `dist` file. Every other `@forge-cms/*` import still resolves through `dist`,
//     which is deliberate: a package's coverage is what ITS OWN tests execute of ITS OWN source;
//   - raw istanbul JSON per package (merged and gated by the aggregator, never by a global threshold).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile } from 'vite';
import { mergeConfig } from 'vitest/config';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkgDir = process.cwd();
const pkg = path.basename(pkgDir);
const testingSrc = path.join(root, 'packages', 'testing', 'src');

const own = await loadConfigFromFile(
  { command: 'serve', mode: 'test' },
  path.join(pkgDir, 'vitest.config.ts')
).catch(() => null);

const overrides = {
  resolve: {
    alias: [
      {
        find: /^@forge-cms\/testing\/contracts$/,
        replacement: path.join(testingSrc, 'contracts', 'index.ts')
      },
      { find: /^@forge-cms\/testing$/, replacement: path.join(testingSrc, 'index.ts') }
    ]
  },
  test: {
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['json'],
      reportsDirectory: path.join(root, 'coverage', 'raw', pkg),
      clean: true,
      allowExternal: true,
      include: ['src/**/*.ts', ...(pkg === 'testing' ? [] : [`${testingSrc}/**/*.ts`])],
      exclude: ['**/*.test.ts', '**/*.test-helpers.ts', '**/*.d.ts', '**/dist/**'],
      thresholds: { statements: 0, branches: 0, functions: 0, lines: 0 }
    }
  }
};

export default mergeConfig(own?.config ?? { test: { include: ['src/**/*.test.ts'] } }, overrides);
