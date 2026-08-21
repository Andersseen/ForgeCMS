import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import {
  D1DatabaseAdapter,
  R2StorageAdapter,
  type D1Database,
  type R2Bucket
} from '@forge-cms/cloudflare';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { collections } from './collections';
import { seedContent } from './seed';
import { setRuntimeRef } from './runtime-ref';

export interface ServerEnv {
  DB?: D1Database;
  /**
   * Must be called `BUCKET`: `R2StorageAdapter.init` reads `env.BUCKET` and throws otherwise, so the
   * binding name is fixed by the adapter rather than configurable (finding 14).
   */
  BUCKET?: R2Bucket;
  AUTH_SECRET?: string;
}

let runtimePromise: Promise<ForgeCmsRuntime<ServerEnv>> | undefined;

/**
 * Lazily builds (and seeds) the runtime on first call. Must only be invoked from inside a request
 * handler: Cloudflare Workers forbids async I/O at module scope, so neither adapter construction
 * nor seeding may run at import time.
 */
export function getServerRuntime(env?: ServerEnv): Promise<ForgeCmsRuntime<ServerEnv>> {
  if (!runtimePromise) {
    runtimePromise = buildRuntime(env);
  }
  return runtimePromise;
}

/** Builds an unseeded runtime. Exported for tests, which seed (or not) as each case needs. */
export function createRuntime(env?: ServerEnv): ForgeCmsRuntime<ServerEnv> {
  const database = env?.DB ? new D1DatabaseAdapter() : new InMemoryDatabaseAdapter();
  // `publicUrlBase` is the path `routes/api/media/[...key].get.ts` serves. It is the adapter's
  // default too, but stating it here keeps the two ends of that contract in one place.
  const storage = env?.BUCKET
    ? new R2StorageAdapter({ publicUrlBase: '/api/media' })
    : new InMemoryStorageAdapter();
  const auth = new UsersCollectionAuthAdapter({ devMode: !env?.AUTH_SECRET }).init({
    ...env,
    userDatabase: database
  });

  const runtime = new ForgeCmsRuntime<ServerEnv>({
    collections,
    adapters: { database, auth, storage },
    ...(env !== undefined && { env })
  });

  runtime.init();
  // Hooks get no handle on the CMS (finding 23), and the demo's limits need to count documents.
  setRuntimeRef(runtime as unknown as ForgeCmsRuntime<never>);
  return runtime;
}

async function buildRuntime(env?: ServerEnv): Promise<ForgeCmsRuntime<ServerEnv>> {
  const runtime = createRuntime(env);
  await runtime.syncSchema();

  // `site_settings` is written exactly once by the seed and by nothing else, so it doubles as the
  // "already seeded?" sentinel — D1 keeps its rows across cold starts, the in-memory adapter does
  // not, and this handles both.
  const existing = await runtime.adapters.database.findMany({
    collection: 'site_settings',
    limit: 1
  });
  if (existing.length === 0) {
    await seedContent(runtime);
  }

  return runtime;
}
