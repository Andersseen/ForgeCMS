import angular from '@analogjs/vite-plugin-angular';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [angular(), tsconfigPaths()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'jsdom'
  }
});
