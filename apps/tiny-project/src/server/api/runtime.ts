import { InMemoryDatabaseAdapter, LibSqlDatabaseAdapter } from '@forge-cms/db';
import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter, type StorageAdapter } from '@forge-cms/storage';
import {
  D1DatabaseAdapter,
  R2StorageAdapter,
  type D1Database,
  type R2Bucket
} from '@forge-cms/cloudflare';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { collections } from './collections';
import { resolveProfile, type ProfileEnv, type ResolvedProfile } from './profile';
import { S3_ENV_KEYS, createS3Storage, type S3Env } from './storage';

export interface ServerEnv extends S3Env, ProfileEnv {
  /** Cloudflare D1 binding: with `BUCKET`, selects the Cloudflare profile (D1 + R2). */
  DB?: D1Database;
  /** Cloudflare R2 binding for uploaded files: the other half of the Cloudflare profile. */
  BUCKET?: R2Bucket;
  /** A libSQL URL (`file:/data/forge.db`, `libsql://…`): with S3, selects the portable profile (libSQL + S3). */
  DATABASE_URL?: string;
  AUTH_SECRET?: string;
  /** Opt-in flag for `POST /api/auth/signup` — unset (disabled) by default, matching apps/www. */
  FORGE_ENABLE_SIGNUP?: string;
}

/**
 * Development mode is an explicit decision (spec 069), never "the secret is missing": Nitro replaces
 * `import.meta.dev` with `true` only under the Analog dev server (`pnpm dev`) and with `false` in every
 * build — deployed, or previewed with `wrangler pages dev`. A build without `AUTH_SECRET` (at least 32
 * bytes) therefore refuses to start instead of signing sessions with Forge's public dev secret.
 */
const AUTH_DEV_MODE = import.meta.dev === true;

/**
 * Spec 084: only development may use the in-memory adapters. Every other build must select a complete durable
 * profile (`profile.ts`) or refuse to start. Tests that deliberately run in memory opt in through
 * `resetServerRuntimeForTests({ development: true })`.
 */
let developmentOverride: boolean | undefined;
const isDevelopment = () => developmentOverride ?? AUTH_DEV_MODE;

let runtimePromise: Promise<ForgeCmsRuntime<ServerEnv>> | undefined;

/**
 * Lazily builds the runtime on first request (Cloudflare Workers forbids async I/O at module
 * scope). Deliberately, unlike every other app in this repo, **this never seeds a user** — the
 * whole point of this fixture is that first-run means zero rows, zero users, so the first-admin
 * bootstrap path (`POST /api/bootstrap-admin`, an app-local route documented in the small-project
 * guide, not a new Forge capability) is exercised for real, not simulated by a seed script.
 */
export function getServerRuntime(env?: ServerEnv): Promise<ForgeCmsRuntime<ServerEnv>> {
  if (!runtimePromise) {
    runtimePromise = buildRuntime(env ?? nodeEnv());
  }
  return runtimePromise;
}

/**
 * Where a Node server (`node-server` preset, or the dev server) gets its configuration: the process
 * environment, restricted to the keys this app reads. Cloudflare passes its bindings as `env` instead.
 */
function nodeEnv(): ServerEnv | undefined {
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  if (!processEnv) return undefined;
  const env: ServerEnv = {};
  if (processEnv['AUTH_SECRET'] !== undefined) env.AUTH_SECRET = processEnv['AUTH_SECRET'];
  if (processEnv['DATABASE_URL'] !== undefined) env.DATABASE_URL = processEnv['DATABASE_URL'];
  if (processEnv['FORGE_ENABLE_SIGNUP'] !== undefined) {
    env.FORGE_ENABLE_SIGNUP = processEnv['FORGE_ENABLE_SIGNUP'];
  }
  for (const key of S3_ENV_KEYS) {
    if (processEnv[key] !== undefined) env[key] = processEnv[key];
  }
  return env;
}

/** The content database of the deployment, as decided by its profile. */
function createDatabase(profile: ResolvedProfile, env: ServerEnv | undefined) {
  if (profile.database === 'd1') return new D1DatabaseAdapter();
  if (profile.database === 'libsql') return new LibSqlDatabaseAdapter(env?.DATABASE_URL ?? '');
  return new InMemoryDatabaseAdapter();
}

async function createStorage(profile: ResolvedProfile): Promise<StorageAdapter> {
  if (profile.storage === 'r2') return new R2StorageAdapter();
  if (profile.storage === 's3' && profile.s3) return createS3Storage(profile.s3);
  return new InMemoryStorageAdapter();
}

async function buildRuntime(env?: ServerEnv): Promise<ForgeCmsRuntime<ServerEnv>> {
  const profile = resolveProfile(env, { development: isDevelopment() });
  const database = createDatabase(profile, env);
  const auth = new UsersCollectionAuthAdapter({ devMode: AUTH_DEV_MODE }).init({
    ...env,
    userDatabase: database
  });

  const runtime = new ForgeCmsRuntime<ServerEnv>({
    collections,
    adapters: {
      database,
      auth,
      storage: await createStorage(profile)
    },
    ...(env !== undefined && { env })
  });

  runtime.init();
  await runtime.syncSchema();

  return runtime;
}

/** Test-only: lets a test rebuild the runtime instead of reusing the module-level singleton. */
export function resetServerRuntimeForTests(options: { development?: boolean } = {}): void {
  runtimePromise = undefined;
  developmentOverride = options.development;
}
