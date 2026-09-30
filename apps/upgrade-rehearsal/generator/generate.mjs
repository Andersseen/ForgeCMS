#!/usr/bin/env node
// Maintainer-only: regenerates one historical upgrade fixture from the PUBLISHED npm packages of that
// release (spec 073 §2). Needs network access (npm). CI never runs this — the rehearsal consumes the
// committed fixtures, and `test/fixtures.test.ts` fails if any fixture file changes by accident.
//
//   pnpm fixtures:upgrade:generate 0.4.0            # refuses to overwrite an existing fixture
//   pnpm fixtures:upgrade:generate 0.4.0 --force    # deliberate regeneration (review the diff!)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, '..', 'fixtures', 'upgrades');

/** Pinned so a regeneration reproduces the same bytes; must match the repository's own pins. */
const LIBSQL_CLIENT = '0.17.3';
const MINIFLARE = '4.20260511.0';
const FORGE_PACKAGES = ['core', 'db', 'auth', 'storage', 'runtime', 'api', 'cloudflare'];

/**
 * Where each published version came from. Evidence is the CI run whose "Release packages to npm" job
 * published it (not the aggregate tag, which spec 072 showed can sit on a later commit).
 */
const PROVENANCE = {
  '0.4.0': {
    sourceCommit: '7103653e2a2df2604c56c5490a5b098afd7a29fb',
    publishedAt: '2026-09-03T13:01:05Z',
    evidence:
      'CI run 33757940308 on 7103653 (PR #34 merge): publish-unpublished published 0.4.0 from that ' +
      'tree with the pending Version Packages bump applied in the working tree. Aggregate tag v0.4.0 ' +
      'points at the same commit.'
  },
  '0.6.0': {
    sourceCommit: 'd2ff7dd0162b4ec34b76cf676b597903d8ee48d3',
    publishedAt: '2026-09-28T08:18:30Z',
    evidence:
      'CI run 36395781099 on d2ff7dd (PR #43, Version Packages): changeset publish. The aggregate tag ' +
      'v0.6.0 points at the later 42fc1d9 (spec 072, table B); it is not the published source.'
  },
  '0.8.0': {
    sourceCommit: '47dfae20598eb3ff3c90b36fee9ae7a5c55005c5',
    publishedAt: '2026-09-28T19:13:00Z',
    evidence:
      'CI run 36469552403 on 47dfae2 (PR #54, Version Packages): changeset publish. Aggregate tag ' +
      'v0.8.0 points at the same commit.'
  }
};

const version = process.argv[2];
const force = process.argv.includes('--force');
if (!version || !PROVENANCE[version]) {
  console.error(
    `Usage: generate.mjs <version> [--force]. Known checkpoints: ${Object.keys(PROVENANCE).join(', ')}`
  );
  process.exit(1);
}
const target = join(fixturesRoot, version);
if (existsSync(target) && !force) {
  console.error(
    `${target} already exists. Historical fixtures are evidence: regenerate only deliberately, with ` +
      '--force, and review the diff.'
  );
  process.exit(1);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const work = mkdtempSync(join(tmpdir(), `forge-fixture-${version}-`));
try {
  const dependencies = Object.fromEntries(
    FORGE_PACKAGES.map((name) => [`@forge-cms/${name}`, version])
  );
  dependencies['@libsql/client'] = LIBSQL_CLIENT;
  dependencies.miniflare = MINIFLARE;
  writeFileSync(
    join(work, 'package.json'),
    JSON.stringify({ name: 'forge-fixture', private: true, type: 'module', dependencies }, null, 2)
  );
  console.log(`Installing published @forge-cms/*@${version} into ${work} …`);
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: work, stdio: 'inherit' });
  cpSync(join(here, 'seed.mjs'), join(work, 'seed.mjs'));

  const runs = {};
  for (const profile of ['libsql', 'd1-r2']) {
    const out = join(work, `out-${profile}`);
    console.log(`Seeding through ${version} on ${profile} …`);
    const stdout = execFileSync('node', ['seed.mjs'], {
      cwd: work,
      env: { ...process.env, FORGE_VERSION: version, PROFILE: profile, OUT: out },
      encoding: 'utf8'
    });
    runs[profile] = { out, summary: JSON.parse(stdout) };
  }

  // One fixture serves both lanes only if both profiles persisted exactly the same thing.
  const [a, b] = [runs.libsql, runs['d1-r2']];
  const same = (file) =>
    sha256(readFileSync(join(a.out, file))) === sha256(readFileSync(join(b.out, file)));
  const storageFiles = (out) => readdirSync(join(out, 'storage')).sort();
  if (
    !same('database.sql') ||
    !same('storage-manifest.json') ||
    JSON.stringify(storageFiles(a.out)) !== JSON.stringify(storageFiles(b.out)) ||
    storageFiles(a.out).some((f) => !same(join('storage', f))) ||
    JSON.stringify(a.summary) !== JSON.stringify(b.summary)
  ) {
    throw new Error(
      `${version}: the libSQL and D1 runs persisted different data. This fixture layout holds one ` +
        'database.sql for both profiles; split it per profile deliberately before regenerating.'
    );
  }

  const lock = JSON.parse(readFileSync(join(work, 'package-lock.json'), 'utf8'));
  const locked = (name) => lock.packages[`node_modules/${name}`];
  const packages = Object.fromEntries(
    FORGE_PACKAGES.map((name) => {
      const entry = locked(`@forge-cms/${name}`);
      return [`@forge-cms/${name}`, { version: entry.version, integrity: entry.integrity }];
    })
  );
  const resolvedDependencies = Object.fromEntries(
    ['@libsql/client', 'drizzle-orm', 'miniflare', 'workerd']
      .filter((name) => locked(name))
      .map((name) => [name, locked(name).version])
  );

  rmSync(target, { recursive: true, force: true });
  mkdirSync(join(target, 'storage'), { recursive: true });
  cpSync(join(a.out, 'database.sql'), join(target, 'database.sql'));
  cpSync(join(a.out, 'storage-manifest.json'), join(target, 'storage-manifest.json'));
  for (const file of storageFiles(a.out)) {
    cpSync(join(a.out, 'storage', file), join(target, 'storage', file));
  }

  const files = {};
  for (const file of [
    'database.sql',
    'storage-manifest.json',
    ...storageFiles(target).map((f) => `storage/${f}`)
  ]) {
    files[file] = `sha256:${sha256(readFileSync(join(target, file)))}`;
  }

  const { summary } = a;
  const manifest = {
    format: 1,
    forgeVersion: version,
    sourceKind: 'published-package',
    sourceCommit: PROVENANCE[version].sourceCommit,
    publishedAt: PROVENANCE[version].publishedAt,
    provenance: PROVENANCE[version].evidence,
    packages,
    resolvedDependencies,
    schemaProfile: 'forge-upgrade-model-v1',
    generatedBy: 'apps/upgrade-rehearsal/generator/generate.mjs + seed.mjs',
    generatedOn: ['libsql', 'd1-r2'],
    profilesIdentical: true,
    features: summary.features,
    counts: summary.counts,
    testCredentials: {
      note: 'Fixture-only test credentials. Never used anywhere real.',
      admin: summary.credentials.admin,
      editor: summary.credentials.editor,
      apiKeys: {
        active: { id: summary.apiKeys.active.id, token: summary.apiKeys.active.secret },
        revoked: { id: summary.apiKeys.revoked.id, token: summary.apiKeys.revoked.secret }
      }
    },
    files
  };
  writeFileSync(join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${target}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
