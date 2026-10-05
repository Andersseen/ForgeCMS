import analog from '@analogjs/platform';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { angularLinker } from '@forge-cms/admin/vite';

export default defineConfig({
  plugins: [
    angularLinker(),
    // SSR (spec 078). `prerender.routes: []`: no build-time render of `/` against an empty build database.
    analog({ ssr: true, prerender: { routes: [] }, nitro: { preset: 'cloudflare-pages' } }),
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
    // `rxjs` stays external under SSR: inlining it makes Vite's SSR runner evaluate its CommonJS build.
    noExternal: ['@angular/**', 'zone.js']
  },
  test: {
    // The slow real-libSQL suite is excluded by the `test` npm script's own `--exclude` flag
    // (`pnpm test:libsql` runs it directly with no exclude) rather than here — `vitest run <file>`
    // still applies this config's `exclude`, which would make targeting the file directly impossible.
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
});
