// Playwright web server: a FRESH durable libSQL database, seeded, served by the BUILT node-server output.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CANARIES } from '../scripts/fixture.ts';

const root = new URL('..', import.meta.url).pathname;
const databaseUrl = `file:${join(mkdtempSync(join(tmpdir(), 'editorial-e2e-')), 'editorial.db')}`;
const env = { ...process.env, DATABASE_URL: databaseUrl, AUTH_SECRET: CANARIES.authSecret };
const seeded = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
  cwd: root,
  env,
  stdio: 'inherit'
});
if (seeded.status !== 0) process.exit(1);
const server = spawn(process.execPath, ['dist/analog/server/index.mjs'], {
  cwd: root,
  env: {
    ...env,
    PORT: process.env['E2E_PORT'] ?? '4610',
    HOST: '127.0.0.1',
    NODE_ENV: 'production'
  },
  stdio: 'inherit'
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 0));
