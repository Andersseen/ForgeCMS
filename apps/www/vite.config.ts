import analog from '@analogjs/platform';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    analog({ ssr: false, nitro: { preset: 'cloudflare-pages' } }),
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
    include: ['src/**/*.test.ts'],
    environment: 'jsdom'
  }
});
