// Packed-artifact certification of one candidate commit — roadmap 0.12 / R01, spec 088. `pnpm release:certify`.
//
// Repository tooling only; it publishes nothing and touches no remote resource. One run:
//
//   preflight  Node/pnpm, git commit, clean tree (a dirty tree is refused unless --allow-dirty, which marks the
//              result NOT certifying), Docker daemon (required: the real-Garage evidence cannot be skipped).
//   build      a forced (uncached) `pnpm build`, so the artifacts come from this tree.
//   pack       all eleven public packages exactly ONCE into an isolated directory; SHA-256 per tarball, the
//              packed manifests inspected, `artifacts.json` written (scripts/certification/artifacts.mjs).
//   stages     every packed verifier, each handed that set through FORGE_CERT_ARTIFACTS so none can repack:
//                consumers  server-only + the 11 roots / 4 retained subpaths (verify-public-consumers.mjs)
//                release    packed manifests + runtime/S3/Cloudflare/upgrade/Angular consumers (verify-release.mjs)
//                compat     strict Angular/admin peer matrix incl. the /studio mount (verify-angular-compat.mjs)
//                ssr        technical SSR/hydration consumer (verify-ssr-consumer.mjs technical)
//                s3         ONE Garage: adapter · lifecycle · packed consumer · S3 recovery · both durable
//                           production profiles (Node+libSQL+S3, workerd+D1+R2) (test-s3.mjs)
//                upgrade    historical upgrade + backup/restore rehearsal (forced, never a Turbo cache hit)
//   seal       the tarball hashes and the git identity are re-checked: nothing changed under the run.
//
// Output (default `.certification/`, gitignored — never committed): `artifacts.json`, `certification-result.json`
// and the tarballs. Neither JSON file holds secrets or host-specific temporary paths.
//
//   pnpm release:certify [--out <dir>] [--allow-dirty] [--stages consumers,release,...]
//
// `--stages` runs a subset and marks the result INCOMPLETE (exit code 2); a full run is the only certification.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ARTIFACTS_ENV,
  PUBLIC_PACKAGES,
  RETAINED_SUBPATHS,
  gitIdentity,
  loadArtifacts,
  packArtifacts
} from './certification/artifacts.mjs';
import { GARAGE_IMAGE, dockerProblem } from './s3-fixture.mjs';
import { VERSIONS } from './ssr-consumer/shared.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const STAGES = [
  { name: 'consumers', command: ['node', 'scripts/verify-public-consumers.mjs'] },
  { name: 'release', command: ['node', 'scripts/verify-release.mjs'] },
  { name: 'compat', command: ['node', 'scripts/verify-angular-compat.mjs'] },
  { name: 'ssr', command: ['node', 'scripts/verify-ssr-consumer.mjs', 'technical'] },
  { name: 's3', command: ['node', 'scripts/test-s3.mjs'], needsDocker: true },
  {
    name: 'upgrade',
    command: [
      'pnpm',
      'exec',
      'turbo',
      'run',
      'test:upgrade',
      '--filter=@forge-cms/upgrade-rehearsal',
      '--force'
    ]
  }
];

const requested = option('--stages')?.split(',');
const unknown = (requested ?? []).filter((name) => !STAGES.some((stage) => stage.name === name));
if (unknown.length > 0) {
  console.error(
    `✗ release:certify — unknown stage ${unknown} (known: ${STAGES.map((s) => s.name)})`
  );
  process.exit(1);
}
const selected = STAGES.filter((stage) => !requested || requested.includes(stage.name));
const complete = selected.length === STAGES.length;

function fail(message) {
  console.error(`\n✗ release:certify — ${message}\n`);
  process.exit(1);
}

function exec(command, argv, env = {}) {
  return new Promise((resolveCode) => {
    console.log(`\n$ ${[command, ...argv].join(' ')}`);
    const child = spawn(command, argv, { stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('error', (err) => {
      console.error(err.message);
      resolveCode(1);
    });
    child.on('exit', (code) => resolveCode(code ?? 1));
  });
}

function capture(command, argv) {
  return new Promise((resolveOut) => {
    let out = '';
    const child = spawn(command, argv, { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('error', () => resolveOut(''));
    child.on('exit', () => resolveOut(out.trim()));
  });
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

// ---------------------------------------------------------------------------------------------------------
// Preflight

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 22) fail(`Node >= 22 is required, found ${process.version}`);

const before = gitIdentity();
const allowDirty = flag('--allow-dirty');
if (before.dirty && !allowDirty) {
  fail(
    `the working tree has ${before.dirtyFileCount} uncommitted change(s). Certify a committed tree, or pass ` +
      '--allow-dirty for a rehearsal (the result is then marked as NOT certifying).'
  );
}
if (selected.some((stage) => stage.needsDocker)) {
  const problem = dockerProblem();
  if (problem !== null) {
    fail(
      'Docker is required (a running daemon) for the real-Garage evidence; it is never skipped.\n' +
        '  Start Docker / Rancher Desktop, or run a subset with --stages (the result is then INCOMPLETE).'
    );
  }
}

const outDir = resolve(option('--out') ?? '.certification');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const packDir = join(outDir, 'packs');

const started = Date.now();
const results = [];

console.log(`Certifying ${before.commit}${before.dirty ? ' (DIRTY tree)' : ''}`);

// ---------------------------------------------------------------------------------------------------------
// Build + pack once

let code = await exec('pnpm', ['exec', 'turbo', 'run', 'build', '--force']);
if (code !== 0) fail('the forced build failed');

let manifest;
try {
  manifest = packArtifacts(packDir, { log: (line) => console.log(line) });
} catch (err) {
  fail(String(err instanceof Error ? err.message : err));
}
if (!manifest.complete) fail('the artifact set does not contain all public packages');
console.log(`\nPacked ${manifest.packages.length} packages @ ${manifest.version} (once):`);
for (const entry of manifest.packages) {
  console.log(`  ${entry.sha256}  ${entry.file}`);
}

// ---------------------------------------------------------------------------------------------------------
// Stages

let failed;
for (const stage of selected) {
  console.log(`\n▶ release:certify stage '${stage.name}'`);
  const stageStarted = Date.now();
  const [command, ...argv] = stage.command;
  code = await exec(command, argv, { [ARTIFACTS_ENV]: packDir });
  const seconds = Math.round((Date.now() - stageStarted) / 1000);
  results.push({ stage: stage.name, status: code === 0 ? 'passed' : 'failed', seconds });
  console.log(`◀ stage '${stage.name}' ${code === 0 ? 'passed' : 'FAILED'} in ${seconds}s`);
  if (code !== 0) {
    failed = stage.name;
    break;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Seal: the artifacts and the tree must be exactly what the run started with.

let sealed = false;
try {
  loadArtifacts(packDir);
  const after = gitIdentity();
  sealed = after.commit === before.commit && after.dirty === before.dirty;
  if (!sealed) console.error('✗ the git identity changed during the run');
} catch (err) {
  console.error(`✗ seal failed: ${err instanceof Error ? err.message : err}`);
}

// ---------------------------------------------------------------------------------------------------------
// Result

const tinyApp = readJson('apps/tiny-project/package.json');
const certifying = complete && !before.dirty && sealed && failed === undefined;
const result = {
  schema: 1,
  outcome: failed
    ? 'failed'
    : !complete
      ? 'incomplete'
      : certifying
        ? 'certified'
        : 'not-certifying',
  note:
    'Local candidate artifacts of the recorded commit. These are NOT the published registry packages of the same ' +
    'version number unless the registry hash is separately compared. Cloudflare evidence is local workerd + local ' +
    'D1 + local R2, not remote staging.',
  git: before,
  version: manifest.version,
  toolchain: {
    ...manifest.toolchain,
    typescript: VERSIONS.typescript,
    angular: VERSIONS.angular,
    analog: VERSIONS.analog,
    vite: VERSIONS.vite,
    rxjs: VERSIONS.rxjs,
    cdk: VERSIONS.cdk,
    voltui: VERSIONS.voltui,
    lumenIcons: VERSIONS.lumenIcons,
    wrangler: VERSIONS.wrangler,
    libsqlClient: tinyApp.dependencies?.['@libsql/client'],
    playwright: tinyApp.devDependencies?.['@playwright/test'],
    garage: GARAGE_IMAGE,
    docker: (await capture('docker', ['--version'])) || null
  },
  packages: manifest.packages.map(({ name, version, file, sha256, bytes }) => ({
    name,
    version,
    file,
    sha256,
    bytes
  })),
  publicPackages: PUBLIC_PACKAGES,
  retainedSubpaths: RETAINED_SUBPATHS,
  stages: results,
  totalSeconds: Math.round((Date.now() - started) / 1000),
  sealed
};
writeFileSync(join(outDir, 'certification-result.json'), `${JSON.stringify(result, null, 2)}\n`);

console.log(
  `\n=== release:certify — ${result.outcome.toUpperCase()} (${result.totalSeconds}s) ===`
);
console.log(
  `commit ${before.commit}${before.dirty ? ' (dirty)' : ''} · version ${manifest.version}`
);
console.table(results);
console.log(`Result: ${join('.certification', 'certification-result.json')} (not committed)`);

if (failed) process.exit(1);
if (!complete) {
  console.log('INCOMPLETE: a subset of stages ran; this is not a certification.');
  process.exit(2);
}
if (!certifying) {
  console.log('NOT CERTIFYING: dirty tree or an unsealed run.');
  process.exit(3);
}
console.log('Certified: every R01 stage passed on one sealed artifact set.');
