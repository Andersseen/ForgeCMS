import { spawn } from 'node:child_process';
import { dockerProblem, startGarage } from './s3-fixture.mjs';

/**
 * Spec 082 (roadmap 0.10 / P01), spec 083 (P02) and spec 084 (P03): runs every real-service portable-storage suite
 * against ONE isolated, throwaway Garage container (see `s3-fixture.mjs`). Repository tooling only — not a Forge
 * package API.
 *
 *   pnpm test:s3                      # all stages, in order
 *   pnpm test:s3 adapter lifecycle    # only the named stages
 *
 * Stages (each gets the same FORGE_S3_TEST_* environment):
 *   adapter    @forge-cms/s3 against Garage (the shared StorageAdapter contract + focused cases)         — P01
 *   lifecycle  on-disk libSQL + S3StorageAdapter through Forge's own upload/serve/delete handlers        — P02
 *   consumer   the same journey from PACKED public packages, in two separate Node processes              — P02
 *   recovery   historical fixtures → upgrade → cold libSQL backup → isolated EMPTY S3 bucket restore      — P03
 *   profiles   the packed, production-built tiny-project on Node + libSQL + S3 (browser SSR/upload journey)
 *              AND on Cloudflare Pages/workerd + local D1 + local R2 (the R2 half needs no Docker but runs
 *              here so both durable profiles are one gate)                                                — P03
 *
 * Needs a running Docker daemon and fails clearly without one; it never skips. The container, its
 * config and its (random, test-only) credentials exist only for this run.
 */
export { GARAGE_IMAGE, GARAGE_REGION } from './s3-fixture.mjs';

function fail(message) {
  console.error(`\n✗ test:s3 — ${message}\n`);
  process.exit(1);
}

const STAGES = [
  {
    name: 'adapter',
    command: ['pnpm', '--filter', '@forge-cms/s3', 'test:integration']
  },
  {
    name: 'lifecycle',
    command: ['pnpm', '--filter', '@forge-cms/tiny-project', 'test:portable-storage']
  },
  { name: 'consumer', command: ['node', 'scripts/verify-portable-storage-consumer.mjs'] },
  {
    name: 'recovery',
    command: ['pnpm', '--filter', '@forge-cms/upgrade-rehearsal', 'test:s3-recovery']
  },
  { name: 'profiles', command: ['node', 'scripts/verify-ssr-consumer.mjs', 'journey'] }
];
const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !STAGES.some((stage) => stage.name === name));
if (unknown.length > 0) {
  console.error(
    `✗ test:s3 — unknown stage ${unknown.join(', ')} (known: ${STAGES.map((s) => s.name).join(', ')})`
  );
  process.exit(1);
}
const selected = STAGES.filter((stage) => requested.length === 0 || requested.includes(stage.name));

const problem = dockerProblem();
if (problem !== null) {
  fail(
    'Docker is required (a running daemon) to start the isolated Garage S3 service.\n' +
      '  Start Docker / Rancher Desktop and re-run `pnpm test:s3`. This suite is never skipped silently.'
  );
}

// Isolated buckets, provisioned by orchestration (never by the adapter): one per recovery source/target,
// plus one for the packed production-profile journey. The default bucket stays for the older stages.
const RECOVERY_BUCKETS = Array.from({ length: 24 }, (_, index) => `forge-rec-${index + 1}`);
const PROFILE_BUCKET = 'forge-s3-profile';

let garage;
try {
  garage = await startGarage({ buckets: [...RECOVERY_BUCKETS, PROFILE_BUCKET] });
} catch (err) {
  fail(String(err instanceof Error ? err.message : err));
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    garage.cleanup();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}
process.on('exit', () => garage.cleanup());

const env = {
  ...process.env,
  ...garage.env,
  FORGE_S3_TEST_RECOVERY_BUCKETS: RECOVERY_BUCKETS.join(','),
  FORGE_S3_TEST_PROFILE_BUCKET: PROFILE_BUCKET
};
let code = 0;
for (const stage of selected) {
  console.log(`\n▶ test:s3 stage '${stage.name}' — ${stage.command.join(' ')}`);
  const started = Date.now();
  const [command, ...args] = stage.command;
  const child = spawn(command, args, { stdio: 'inherit', env });
  code = await new Promise((resolve) => {
    child.on('error', (err) => {
      console.error(`could not run stage '${stage.name}': ${err.message}`);
      resolve(1);
    });
    child.on('exit', (c) => resolve(c ?? 1));
  });
  console.log(
    `◀ stage '${stage.name}' ${code === 0 ? 'passed' : 'FAILED'} in ${Math.round((Date.now() - started) / 1000)}s`
  );
  if (code !== 0) break;
}
garage.cleanup();
process.exit(code);
