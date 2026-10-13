import analog from '@analogjs/platform';
import { defineConfig } from 'vite';
import { angularLinker } from '@forge-cms/admin/vite';

export default defineConfig({
  plugins: [
    // Forge ships partial-Ivy code; the official linker compiles it at build time.
    angularLinker(),
    analog({ ssr: false, nitro: { preset: 'node-server' } })
  ],
  build: { target: 'es2022' }
});
