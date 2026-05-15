import angular from '@analogjs/vite-plugin-angular';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@forge-cms/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url))
    },
    mainFields: ['module']
  },
  plugins: [angular()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'jsdom'
  }
});
