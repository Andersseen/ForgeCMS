// Quickstart consumers — roadmap 0.12 / R04, spec 091. `pnpm docs:verify:consumers`.
//
// The two canonical quickstarts are executable. Their source lives in `docs/examples/*` and is the very text
// the documentation embeds (`scripts/docs/verify-docs.mjs` fails when a page drifts from it). Here each one is
// installed into a CLEAN temporary project from the packed public tarballs only — strict peers, no automatic
// peer installation, no workspace/alias shortcuts — and exercised:
//
//   server   core · db · auth · storage · api · runtime and nothing else (no Angular, admin, VoltUI, CDK, lumen).
//            strict `tsc`, then the built Node output runs the first-admin + Local API + HTTP-handler journey.
//   angular  server packages + @forge-cms/angular + @forge-cms/admin with ONLY the documented peers, the
//            official `angularLinker`, strict TypeScript and strict templates, an Analog production build,
//            and the built server answering the documented routes.
//
// Reuses the R01 tarball set (`FORGE_CERT_ARTIFACTS`) or packs once through scripts/certification/artifacts.mjs.
// Usage: node scripts/docs/quickstart-consumers.mjs [server] [angular]   (default: both)

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertCleanConsumer, resolveTarballs } from '../certification/artifacts.mjs';
import { NPMRC, VERSIONS } from '../ssr-consumer/shared.mjs';
import { copyExample, keep, run } from './shared.mjs';
import { verifyAngularQuickstart } from './angular-quickstart-consumer.mjs';

const stages = process.argv.slice(2);
const selected = (name) => stages.length === 0 || stages.includes(name);

const SERVER_PACKAGES = [
  '@forge-cms/core',
  '@forge-cms/db',
  '@forge-cms/auth',
  '@forge-cms/storage',
  '@forge-cms/api',
  '@forge-cms/runtime'
];

/** Store entries a server-only project must never contain. */
const FRONTEND_ENTRIES = [
  /^@angular\+/,
  /^@voltui\+/,
  /^lumen-icons@/,
  /^rxjs@/,
  /^zone\.js@/,
  /^@forge-cms\+angular@/,
  /^@forge-cms\+admin@/
];

function verifyServer(workDir, allTarballs) {
  const dir = join(workDir, 'server');
  const tarballs = Object.fromEntries(SERVER_PACKAGES.map((name) => [name, allTarballs[name]]));
  mkdirSync(dir, { recursive: true });
  copyExample('server-quickstart', dir);
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'forge-server-quickstart',
        version: '0.0.0',
        private: true,
        type: 'module',
        dependencies: tarballs,
        devDependencies: { typescript: VERSIONS.typescript, '@types/node': '22.15.3' },
        pnpm: { overrides: tarballs }
      },
      null,
      2
    )}\n`
  );
  writeFileSync(join(dir, '.npmrc'), NPMRC);
  assertCleanConsumer(dir, 'server quickstart');
  run('pnpm', ['install', '--prefer-offline'], dir);

  const store = readdirSync(join(dir, 'node_modules', '.pnpm'));
  const frontend = store.filter((entry) => FRONTEND_ENTRIES.some((pattern) => pattern.test(entry)));
  if (frontend.length > 0)
    throw new Error(`the server quickstart installed frontend packages: ${frontend}`);

  run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], dir);
  const first = run('node', ['dist/main.js'], dir, {
    DATABASE_URL: `file:${join(dir, 'forge.db')}`
  });
  process.stdout.write(first);
  for (const expected of [
    'Local API: 1 note(s)',
    'HTTP handler: 200 1 note(s)',
    'Anonymous create refused:'
  ]) {
    if (!first.includes(expected)) throw new Error(`server quickstart output lacks "${expected}"`);
  }
  console.log('  ✓ server quickstart: no Angular/admin installed, strict tsc, built output ran');
}

const workDir = mkdtempSync(join(tmpdir(), 'forge-cms-quickstarts-'));
try {
  const tarballs = resolveTarballs(join(workDir, 'packs'), undefined, {
    log: (line) => console.log(line)
  });
  if (selected('server')) verifyServer(workDir, tarballs);
  if (selected('angular')) await verifyAngularQuickstart({ workDir, tarballs });
  console.log('\nQuickstart consumers passed.');
} finally {
  if (keep) console.log(`Keeping ${workDir}`);
  else rmSync(workDir, { recursive: true, force: true });
}
