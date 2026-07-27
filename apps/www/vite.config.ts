import analog from '@analogjs/platform';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { angularLinker } from './vite-plugins/angular-linker';
import { escapeCodespans } from './vite-plugins/escape-codespans';

export default defineConfig({
  plugins: [
    angularLinker(),
    analog({
      ssr: false,
      nitro: { preset: 'cloudflare-pages' },
      // Parses `src/content/**/*.md` at build time (marked + Prism), so `/docs` ships pre-rendered,
      // pre-highlighted HTML instead of a markdown parser. See docs/specs/043.
      content: { highlighter: 'prism', markedOptions: { extensions: [escapeCodespans] } }
    }),
    tailwindcss(),
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
    include: ['src/**/*.test.ts', 'vite-plugins/**/*.test.ts'],
    environment: 'jsdom'
  }
});
