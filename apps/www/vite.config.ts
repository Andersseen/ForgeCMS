import angular from '@analogjs/vite-plugin-angular';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@forge-cms/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url))
    },
    mainFields: ['module']
  },
  plugins: [angular(), tailwindcss()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'jsdom'
  }
});
