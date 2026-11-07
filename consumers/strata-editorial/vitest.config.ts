import { defineConfig } from 'vitest/config';

// Unit tests run the ForgeCMS Local API on in-memory adapters; no Vite/Analog/Strata build involved.
// Strata controllers use STANDARD decorators (the root tsconfig's experimentalDecorators is for Angular).
export default defineConfig({
  esbuild: { tsconfigRaw: { compilerOptions: { experimentalDecorators: false } } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' }
});
