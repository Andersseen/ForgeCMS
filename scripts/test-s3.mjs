import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Spec 082 (roadmap 0.10 / P01): runs the real-service integration suite of @forge-cms/s3 against an
 * isolated, throwaway Garage container. Repository tooling only — not a Forge package API.
 *
 *   pnpm test:s3
 *
 * Needs a running Docker daemon and fails clearly without one; it never skips. The container, its
 * config and its (random, test-only) credentials exist only for this run.
 */

// Current Garage release at spec time (Docker Hub dxflrs/garage; quick-start documents v2.4.1).
// Pinned by tag AND manifest digest so a re-tagged image can never change what CI certifies.
export const GARAGE_IMAGE =
  'dxflrs/garage:v2.4.1@sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020';
export const GARAGE_REGION = 'garage';
const BUCKET = 'forge-s3-test';

function docker(args, options = {}) {
  return spawnSync('docker', args, { encoding: 'utf8', ...options });
}

function fail(message) {
  console.error(`\n✗ test:s3 — ${message}\n`);
  cleanup();
  process.exit(1);
}

let cleanup = () => {};

const info = docker(['info', '--format', '{{.ServerVersion}}']);
if (info.error || info.status !== 0) {
  fail(
    'Docker is required (a running daemon) to start the isolated Garage S3 service.\n' +
      '  Start Docker / Rancher Desktop and re-run `pnpm test:s3`. This suite is never skipped silently.'
  );
}

const hex = (bytes) => randomBytes(bytes).toString('hex');
const accessKeyId = `GK${hex(12)}`; // Garage key ids are "GK" + 24 hex characters
const secretAccessKey = hex(32);
const workDir = mkdtempSync(join(tmpdir(), 'forge-s3-'));
const container = `forge-s3-test-${process.pid}`;

writeFileSync(
  join(workDir, 'garage.toml'),
  `metadata_dir = "/tmp/meta"
data_dir = "/tmp/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "${hex(32)}"

[s3_api]
s3_region = "${GARAGE_REGION}"
api_bind_addr = "[::]:3900"

[admin]
api_bind_addr = "[::]:3903"
admin_token = "${hex(24)}"
`
);

let cleaned = false;
cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  docker(['rm', '-f', '-v', container], { stdio: 'ignore' });
  rmSync(workDir, { recursive: true, force: true });
};
process.on('exit', () => cleanup());
for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143]
]) {
  process.on(signal, () => {
    cleanup();
    process.exit(code);
  });
}

try {
  console.log(`$ docker run ${GARAGE_IMAGE} (single node, ephemeral)`);
  const run = docker([
    'run',
    '-d',
    '--name',
    container,
    '-p',
    '127.0.0.1::3900',
    '-v',
    `${join(workDir, 'garage.toml')}:/etc/garage.toml:ro`,
    '-e',
    `GARAGE_DEFAULT_ACCESS_KEY=${accessKeyId}`,
    '-e',
    `GARAGE_DEFAULT_SECRET_KEY=${secretAccessKey}`,
    '-e',
    `GARAGE_DEFAULT_BUCKET=${BUCKET}`,
    GARAGE_IMAGE,
    '/garage',
    'server',
    '--single-node',
    '--default-bucket'
  ]);
  if (run.status !== 0) fail(`could not start Garage:\n${run.stderr}`);

  const portLine = docker(['port', container, '3900/tcp']).stdout.trim().split('\n')[0] ?? '';
  const port = portLine.split(':').at(-1);
  if (!port) fail('could not resolve the published Garage S3 port');
  const endpoint = `http://127.0.0.1:${port}`;

  // Wait until the S3 API answers (Garage rejects the unsigned request, which is enough to prove it is up).
  let ready = false;
  for (let attempt = 0; attempt < 60 && !ready; attempt++) {
    try {
      await fetch(endpoint, { signal: AbortSignal.timeout(1000) });
      ready = true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!ready) {
    const logs = docker(['logs', '--tail', '40', container]);
    fail(`Garage did not become ready:\n${logs.stdout}${logs.stderr}`);
  }

  console.log(`Garage ready at ${endpoint} (region ${GARAGE_REGION}, bucket ${BUCKET})`);
  const child = spawn('pnpm', ['--filter', '@forge-cms/s3', 'test:integration'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      FORGE_S3_TEST_ENDPOINT: endpoint,
      FORGE_S3_TEST_REGION: GARAGE_REGION,
      FORGE_S3_TEST_BUCKET: BUCKET,
      FORGE_S3_TEST_ACCESS_KEY_ID: accessKeyId,
      FORGE_S3_TEST_SECRET_ACCESS_KEY: secretAccessKey,
      FORGE_S3_TEST_IMAGE: GARAGE_IMAGE
    }
  });
  const code = await new Promise((resolve) => {
    child.on('error', (err) => {
      console.error(`could not run the integration suite: ${err.message}`);
      resolve(1);
    });
    child.on('exit', (c) => resolve(c ?? 1));
  });
  cleanup();
  process.exit(code);
} catch (err) {
  cleanup();
  throw err;
}
