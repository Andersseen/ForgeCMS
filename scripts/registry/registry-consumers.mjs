#!/usr/bin/env node
// Real-registry consumers — roadmap L02. `pnpm registry:consumers --version 1.0.0-rc.2 [server] [angular] [agent]`.
//
// Explicit, opt-in, NOT part of any normal PR gate: it needs the public npm registry. Everything the packed
// verifiers prove about OUR tarballs, this proves about what npm serves. Each stage builds a fresh project in the
// OS temp directory (outside the monorepo, under no pnpm workspace) that installs `@forge-cms/*` at one exact
// version from https://registry.npmjs.org with a private empty package store, strict peers and no automatic peer
// installation, then asserts on the lockfile and the installed tree that nothing else (no local tarball, no
// workspace link, no second Forge version) was used.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCleanConsumer } from '../certification/artifacts.mjs';
import { verifyAngularQuickstart } from '../docs/angular-quickstart-consumer.mjs';
import { keep, repoRoot, run } from '../docs/shared.mjs';
import { VERSIONS } from '../ssr-consumer/shared.mjs';
import { registryBrowserChecks } from './angular-extras.mjs';
import { verifyAgentRegistry } from './agent-registry.mjs';
import {
  REGISTRY_NPMRC,
  assertExactVersion,
  installedProblems,
  isolatedEnv,
  lockfileProblems,
  registrySpecs,
  workspaceProblems
} from './lib.mjs';
import { runServerJourney } from './server-journey.mjs';

export const SERVER_PACKAGES = [
  '@forge-cms/core',
  '@forge-cms/db',
  '@forge-cms/auth',
  '@forge-cms/storage',
  '@forge-cms/api',
  '@forge-cms/runtime'
];
export const ANGULAR_PACKAGES = [...SERVER_PACKAGES, '@forge-cms/angular', '@forge-cms/admin'];

const FRONTEND_ENTRIES = [
  /^@angular\+/,
  /^@voltui\+/,
  /^lumen-icons@/,
  /^rxjs@/,
  /^zone\.js@/,
  /^@forge-cms\+angular@/,
  /^@forge-cms\+admin@/
];

const fail = (message) => {
  throw new Error(message);
};

/** Assertions every registry stage makes after `pnpm install`. */
export function assertRegistryInstall(dir, names, version) {
  const problems = [
    ...workspaceProblems(dir, repoRoot),
    ...lockfileProblems(readFileSync(join(dir, 'pnpm-lock.yaml'), 'utf8'), { version, names }),
    ...installedProblems(dir, { version, names })
  ];
  if (problems.length > 0) fail(`registry install is not clean:\n  - ${problems.join('\n  - ')}`);
  console.log(
    `  ✓ ${names.length} Forge packages at exactly ${version}, from the registry, no workspace/local resolution`
  );
}

/** Forge packages a consumer's package.json declares (dependencies or devDependencies). */
function declaredForgePackages(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
    .filter((name) => name.startsWith('@forge-cms/'))
    .sort();
}

/** The `install` option every consumer builder takes, in real-registry mode (see `ssr-consumer/shared.mjs`). */
export function registryInstallOptions(version, { label, reportDir } = {}) {
  return {
    npmrc: REGISTRY_NPMRC,
    args: [],
    registryVersion: version,
    afterInstall: (dir) => {
      assertRegistryInstall(dir, declaredForgePackages(dir), version);
      if (label) saveLock(dir, label, reportDir);
    }
  };
}

/** Makes this process an isolated registry client: private empty store/cache, no leaked npm_config_* variables. */
export function isolateProcess(workDir) {
  const clean = isolatedEnv(process.env, {
    storeDir: join(workDir, 'store'),
    cacheDir: join(workDir, 'cache')
  });
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, clean);
}

function saveLock(dir, label, reportDir) {
  if (!reportDir) return;
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(
    join(reportDir, `${label}.pnpm-lock.yaml`),
    readFileSync(join(dir, 'pnpm-lock.yaml'), 'utf8')
  );
}

async function verifyServer({ workDir, version, reportDir }) {
  const dir = join(workDir, 'server');
  mkdirSync(dir, { recursive: true });
  const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'server');
  for (const entry of readdirSync(fixture, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const source = join(entry.parentPath, entry.name);
    const target = join(dir, source.slice(fixture.length + 1));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(source));
  }
  const forge = registrySpecs(SERVER_PACKAGES, version);
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'forge-registry-server-consumer',
        version: '0.0.0',
        private: true,
        type: 'module',
        dependencies: forge,
        devDependencies: { typescript: VERSIONS.typescript, '@types/node': '22.15.3' },
        pnpm: { overrides: forge }
      },
      null,
      2
    )}\n`
  );
  writeFileSync(join(dir, '.npmrc'), REGISTRY_NPMRC);
  assertCleanConsumer(dir, 'registry server consumer', { registryVersion: version });
  run('pnpm', ['install'], dir);
  assertRegistryInstall(dir, SERVER_PACKAGES, version);
  saveLock(dir, 'server', reportDir);

  const frontend = readdirSync(join(dir, 'node_modules', '.pnpm')).filter((entry) =>
    FRONTEND_ENTRIES.some((pattern) => pattern.test(entry))
  );
  if (frontend.length > 0)
    fail(`the server-only consumer installed frontend packages: ${frontend}`);
  console.log('  ✓ no Angular / admin / Volt UI / CDK / RxJS / zone.js in the dependency graph');

  run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], dir);
  console.log(
    '  ✓ strict TypeScript compile (exactOptionalPropertyTypes, noUncheckedIndexedAccess) against the published declarations'
  );
  await runServerJourney({ dir, databaseUrl: `file:${join(dir, 'forge.db')}` });
}

async function verifyAngular({ workDir, version, reportDir }) {
  await verifyAngularQuickstart({
    workDir,
    tarballs: registrySpecs(ANGULAR_PACKAGES, version),
    install: {
      ...registryInstallOptions(version, { label: 'angular', reportDir }),
      browserChecks: registryBrowserChecks
    }
  });
}

/** Runs a packed-mode SSR verifier in real-registry mode (it isolates itself; see `verify-ssr-consumer.mjs`). */
function delegate(args, version) {
  console.log(`$ FORGE_REGISTRY_VERSION=${version} node ${args.join(' ')}`);
  execFileSync(process.execPath, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, FORGE_REGISTRY_VERSION: version }
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const versionIndex = argv.indexOf('--version');
  const version = assertExactVersion(versionIndex >= 0 ? argv[versionIndex + 1] : undefined);
  const stages = argv.filter((arg, i) => !arg.startsWith('--') && argv[i - 1] !== '--version');
  // `ssr-journey` needs Docker (Garage S3) and is opt-in by name; every other stage runs by default.
  const selected = (name) => (stages.length === 0 ? name !== 'ssr-journey' : stages.includes(name));

  const workDir = mkdtempSync(join(tmpdir(), 'forge-registry-consumers-'));
  const reportDir = process.env['FORGE_REGISTRY_REPORT']
    ? resolve(process.env['FORGE_REGISTRY_REPORT'])
    : undefined;
  isolateProcess(workDir);
  console.log(`Registry consumers for ${version} in ${workDir}`);
  try {
    if (selected('server')) {
      console.log('\n== server-only consumer');
      await verifyServer({ workDir, version, reportDir });
    }
    if (selected('angular')) {
      console.log('\n== Angular / Analog consumer');
      await verifyAngular({ workDir, version, reportDir });
    }
    if (selected('ssr')) {
      console.log('\n== SSR / hydration consumer (technical)');
      delegate(['scripts/verify-ssr-consumer.mjs', 'technical'], version);
    }
    if (selected('ssr-journey')) {
      console.log('\n== SSR + admin + durable-file journey (Node+libSQL+S3 Garage, workerd+D1+R2)');
      delegate(['scripts/test-s3.mjs', 'profiles'], version);
    }
    if (selected('agent')) {
      console.log('\n== Agent Kit smoke');
      await verifyAgentRegistry({ workDir, version, reportDir });
    }
    console.log(`\nRegistry consumers passed for ${version}.`);
  } finally {
    if (keep) console.log(`Keeping ${workDir}`);
    else rmSync(workDir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
