import analog from '@analogjs/platform';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { angularLinker } from '@forge-cms/admin/vite';

export default defineConfig({
  plugins: [
    angularLinker(),
    analog({ ssr: false, nitro: { preset: 'cloudflare-pages' } }),
    tsconfigPaths()
  ],
  optimizeDeps: {
    include: [
      '@angular/common',
      '@angular/core',
      '@angular/platform-browser',
      '@angular/router',
      'zone.js',
      'rxjs'
    ],
    exclude: ['@angular/compiler']
  },
  ssr: {
    noExternal: ['@angular/**', 'zone.js', 'rxjs']
  },
  test: {
    // The slow real-libSQL suite is excluded by the `test` npm script's own `--exclude` flag
    // (`pnpm test:libsql` runs it directly with no exclude) rather than here — `vitest run <file>`
    // still applies this config's `exclude`, which would make targeting the file directly impossible.
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
});
