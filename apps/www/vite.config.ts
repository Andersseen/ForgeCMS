import angular from '@analogjs/vite-plugin-angular';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [angular(), tailwindcss(), tsconfigPaths()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'jsdom'
  }
});
