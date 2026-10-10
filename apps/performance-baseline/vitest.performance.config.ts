import angular from '@analogjs/vite-plugin-angular';
import { defineConfig } from 'vitest/config';

// The measurement run (spec 089). One file at a time, one worker: wall-clock samples must not compete with
// each other. `--expose-gc` lets the memory baseline take garbage-collected readings. The Angular compile
// transform is needed only by the admin list-render measurement (signal inputs under TestBed).
export default defineConfig({
  plugins: [angular({ jit: true, tsconfig: './tsconfig.perf.json' })],
  test: {
    include: ['perf/**/*.perf.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    isolate: true,
    pool: 'forks',
    execArgv: ['--expose-gc'],
    testTimeout: 300_000,
    hookTimeout: 120_000
  }
});
