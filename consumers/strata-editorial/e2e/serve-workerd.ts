// Playwright web server for the Cloudflare profile: local workerd (`wrangler pages dev`) on the BUILT Pages
// output, with a FRESH local D1 seeded with the same synthetic fixture. Nothing remote is created or touched.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CANARIES } from '../scripts/fixture.ts';

const root = new URL('..', import.meta.url).pathname;
const port = process.env['E2E_PORT'] ?? '4610';
const work = mkdtempSync(join(tmpdir(), 'editorial-d1-'));
const run = (command: string, args: string[], env: NodeJS.ProcessEnv = process.env) => {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
};

// 1. The fixture through the ForgeCMS Local API (libSQL), dumped to SQL for D1.
run(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
  ...process.env,
  DATABASE_URL: `file:${join(work, 'seed.db')}`,
  AUTH_SECRET: CANARIES.authSecret
});
const dump = spawnSync('sqlite3', [join(work, 'seed.db'), '.dump'], { encoding: 'utf8' });
if (dump.status !== 0) throw new Error('sqlite3 .dump failed');
const sql = dump.stdout
  .split('\n')
  .filter((line) => !/^(PRAGMA|BEGIN TRANSACTION|COMMIT)|sqlite_sequence/.test(line))
  .join('\n');
spawnSync('sh', ['-c', `cat > ${join(work, 'seed.sql')}`], { input: sql });

// 2. A fresh LOCAL D1 state.
rmSync(join(root, '.wrangler'), { recursive: true, force: true });
run('pnpm', [
  'exec',
  'wrangler',
  'd1',
  'execute',
  'forge-strata-editorial-local',
  '--local',
  '--file',
  join(work, 'seed.sql')
]);

// 3. workerd. The secret is a local binding for this run only.
const server = spawn(
  'pnpm',
  [
    'exec',
    'wrangler',
    'pages',
    'dev',
    'dist/analog/public',
    '--port',
    port,
    '--ip',
    '127.0.0.1',
    '--binding',
    `AUTH_SECRET=${CANARIES.authSecret}`
  ],
  { cwd: root, stdio: 'inherit' }
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 0));
