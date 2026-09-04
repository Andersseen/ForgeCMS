import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { D1DatabaseAdapter, type D1Database } from '@forge-cms/cloudflare';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { collections } from './collections';

export interface ServerEnv {
  DB?: D1Database;
  AUTH_SECRET?: string;
  /** Opt-in flag for `POST /api/auth/signup` — unset (disabled) by default, matching apps/www. */
  FORGE_ENABLE_SIGNUP?: string;
}

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
    runtimePromise = buildRuntime(env);
  }
  return runtimePromise;
}

async function buildRuntime(env?: ServerEnv): Promise<ForgeCmsRuntime<ServerEnv>> {
  const database = env?.DB ? new D1DatabaseAdapter() : new InMemoryDatabaseAdapter();
  const auth = new UsersCollectionAuthAdapter({ devMode: !env?.AUTH_SECRET }).init({
    ...env,
    userDatabase: database
  });

  const runtime = new ForgeCmsRuntime<ServerEnv>({
    collections,
    adapters: {
      database,
      auth,
      storage: new InMemoryStorageAdapter()
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
