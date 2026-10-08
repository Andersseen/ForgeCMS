import { InMemoryDatabaseAdapter, LibSqlDatabaseAdapter } from '@forge-cms/db';
import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { D1DatabaseAdapter, type D1Database } from '@forge-cms/cloudflare';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { collections } from './collections';
import { S3_ENV_KEYS, selectStorage, type S3Env } from './storage';

export interface ServerEnv extends S3Env {
  /** Cloudflare D1 binding: selects the D1 profile. */
  DB?: D1Database;
  /** A libSQL URL (`file:/data/forge.db`, `libsql://…`): selects the portable libSQL profile. */
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

/** The content database of the deployment: D1, else libSQL, else in-memory (local development). */
function selectDatabase(env: ServerEnv | undefined) {
  if (env?.DB) return new D1DatabaseAdapter();
  if (env?.DATABASE_URL) return new LibSqlDatabaseAdapter(env.DATABASE_URL);
  return new InMemoryDatabaseAdapter();
}

async function buildRuntime(env?: ServerEnv): Promise<ForgeCmsRuntime<ServerEnv>> {
  const database = selectDatabase(env);
  const auth = new UsersCollectionAuthAdapter({ devMode: AUTH_DEV_MODE }).init({
    ...env,
    userDatabase: database
  });

  const runtime = new ForgeCmsRuntime<ServerEnv>({
    collections,
    adapters: {
      database,
      auth,
      storage: await selectStorage(env)
    },
    ...(env !== undefined && { env })
  });

  runtime.init();
  await runtime.syncSchema();

  return runtime;
}

/** Test-only: lets a test rebuild the runtime instead of reusing the module-level singleton. */
export function resetServerRuntimeForTests(): void {
  runtimePromise = undefined;
}
