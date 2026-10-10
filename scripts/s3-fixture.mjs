import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Spec 082/083/084: the ONE place that starts the real S3-compatible service the repository certifies —
 * a single-node, throwaway Garage container with random test-only credentials. Repository tooling only: it is
 * not exported from any `@forge-cms/*` package, and `S3StorageAdapter` never creates buckets (provisioning
 * is infrastructure/test orchestration, which is what this file is).
 *
 * `scripts/test-s3.mjs` owns it for `pnpm test:s3`; a stage receives `FORGE_S3_TEST_*` in its environment.
 */

// Current Garage release at spec time (Docker Hub dxflrs/garage; quick-start documents v2.4.1).
// Pinned by tag AND manifest digest so a re-tagged image can never change what CI certifies.
export const GARAGE_IMAGE =
  'dxflrs/garage:v2.4.1@sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020';
export const GARAGE_REGION = 'garage';
export const DEFAULT_BUCKET = 'forge-s3-test';

export function docker(args, options = {}) {
  return spawnSync('docker', args, { encoding: 'utf8', ...options });
}

/** `null` when a Docker daemon answers, else the reason it does not. */
export function dockerProblem() {
  const info = docker(['info', '--format', '{{.ServerVersion}}']);
  return info.error || info.status !== 0 ? (info.error?.message ?? info.stderr) : null;
}

const hex = (bytes) => randomBytes(bytes).toString('hex');

/**
 * Starts Garage and waits until its S3 API answers. `buckets` are extra buckets created next to the default
 * one (each readable/writable by the test key) — e.g. an isolated source and restore target for the recovery
 * rehearsal. Throws (after cleaning up) when the service cannot start.
 */
export async function startGarage({ buckets = [] } = {}) {
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
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    docker(['rm', '-f', '-v', container], { stdio: 'ignore' });
    rmSync(workDir, { recursive: true, force: true });
  };

  try {
    console.log(`$ docker run ${GARAGE_IMAGE} (single node, ephemeral)`);
    // `create` + `cp` + `start` instead of a bind mount: a mounted host path must be shared with the Docker VM
    // (Colima, Rancher Desktop and Docker Desktop each share different directories, and not the OS temp dir by
    // default), whereas copying the config in works with every daemon.
    const created = docker([
      'create',
      '--name',
      container,
      '-p',
      '127.0.0.1::3900',
      '-e',
      `GARAGE_DEFAULT_ACCESS_KEY=${accessKeyId}`,
      '-e',
      `GARAGE_DEFAULT_SECRET_KEY=${secretAccessKey}`,
      '-e',
      `GARAGE_DEFAULT_BUCKET=${DEFAULT_BUCKET}`,
      GARAGE_IMAGE,
      '/garage',
      'server',
      '--single-node',
      '--default-bucket'
    ]);
    if (created.status !== 0) throw new Error(`could not create Garage:\n${created.stderr}`);
    const copied = docker(['cp', join(workDir, 'garage.toml'), `${container}:/etc/garage.toml`]);
    if (copied.status !== 0) throw new Error(`could not copy the Garage config:\n${copied.stderr}`);
    const run = docker(['start', container]);
    if (run.status !== 0) throw new Error(`could not start Garage:\n${run.stderr}`);

    const portLine = docker(['port', container, '3900/tcp']).stdout.trim().split('\n')[0] ?? '';
    const port = portLine.split(':').at(-1);
    if (!port) throw new Error('could not resolve the published Garage S3 port');
    const endpoint = `http://127.0.0.1:${port}`;

    // The S3 API answers (rejecting the unsigned request is enough to prove it is up).
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
      throw new Error(`Garage did not become ready:\n${logs.stdout}${logs.stderr}`);
    }

    for (const bucket of buckets) {
      const create = docker(['exec', container, '/garage', 'bucket', 'create', bucket]);
      if (create.status !== 0) {
        throw new Error(`could not create bucket ${bucket}:\n${create.stdout}${create.stderr}`);
      }
      const allow = docker([
        'exec',
        container,
        '/garage',
        'bucket',
        'allow',
        '--read',
        '--write',
        '--owner',
        bucket,
        '--key',
        accessKeyId
      ]);
      if (allow.status !== 0) {
        throw new Error(
          `could not grant the test key on ${bucket}:\n${allow.stdout}${allow.stderr}`
        );
      }
    }

    console.log(
      `Garage ready at ${endpoint} (region ${GARAGE_REGION}, buckets ${[DEFAULT_BUCKET, ...buckets].join(', ')})`
    );
    return {
      endpoint,
      region: GARAGE_REGION,
      bucket: DEFAULT_BUCKET,
      accessKeyId,
      secretAccessKey,
      /** The `FORGE_S3_TEST_*` environment every real-service stage receives. */
      env: {
        FORGE_S3_TEST_ENDPOINT: endpoint,
        FORGE_S3_TEST_REGION: GARAGE_REGION,
        FORGE_S3_TEST_BUCKET: DEFAULT_BUCKET,
        FORGE_S3_TEST_ACCESS_KEY_ID: accessKeyId,
        FORGE_S3_TEST_SECRET_ACCESS_KEY: secretAccessKey,
        FORGE_S3_TEST_IMAGE: GARAGE_IMAGE
      },
      cleanup
    };
  } catch (err) {
    cleanup();
    throw err;
  }
}
