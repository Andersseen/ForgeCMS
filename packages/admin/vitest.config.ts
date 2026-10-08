import angular from '@analogjs/vite-plugin-angular';
import { defineConfig } from 'vitest/config';

// The Angular compile transform is what makes signal `input()`/`output()` real inputs under test:
// plain JIT does not see them, so rendered component tests (spec 085) could not bind a template.
export default defineConfig({
  plugins: [angular({ jit: true, tsconfig: './tsconfig.json' })],
  test: {
    include: ['src/**/*.test.ts']
  }
});
