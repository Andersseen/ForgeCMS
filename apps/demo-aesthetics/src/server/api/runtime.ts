import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import {
  D1DatabaseAdapter,
  R2StorageAdapter,
  type D1Database,
  type R2Bucket,
  type AnalyticsEngineDataset
} from '@forge-cms/cloudflare';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { collections, type DemoCollections } from './collections';
import { seedContent } from './seed';
import { setRuntimeRef } from './runtime-ref';

export interface ServerEnv {
  /**
   * `DB`/`BUCKET` are the adapters' default binding names (both take `binding` since spec 040). This
   * app keeps them because the deployed Pages project is bound under exactly these names.
   */
  DB?: D1Database;
  BUCKET?: R2Bucket;
  AUTH_SECRET?: string;
  /** Opt-in flag for `POST /api/auth/signup` — unset (disabled) by default, see spec 054 §7. */
  FORGE_ENABLE_SIGNUP?: string;
  /**
   * Forge Analytics (spec 057, experimental). Read directly by `routes/api/analytics/*` — not
   * wired into `ForgeCmsRuntime`'s `adapters`, since pageviews are not CMS documents.
   */
  ANALYTICS?: AnalyticsEngineDataset;
  /** Stable per-deployment identifier written as the dataset's `index1`. Defaults to `'default'`. */
  FORGE_ANALYTICS_SITE_ID?: string;
  /** Server-only secrets for the Analytics Engine SQL API (query side only — writes need no secret). */
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_ANALYTICS_TOKEN?: string;
}

/**
 * The runtime with the typed registry (spec 047): `find`/`findOne`/`findByID`/`create`/… check
 * collection slugs, `where`/`sort` keys and write payloads, and return typed documents.
 */
export type DemoRuntime = ForgeCmsRuntime<ServerEnv, DemoCollections>;

let runtimePromise: Promise<DemoRuntime> | undefined;

/**
 * Lazily builds (and seeds) the runtime on first call. Must only be invoked from inside a request
 * handler: Cloudflare Workers forbids async I/O at module scope, so neither adapter construction
 * nor seeding may run at import time.
 */
export function getServerRuntime(env?: ServerEnv): Promise<DemoRuntime> {
  if (!runtimePromise) {
    runtimePromise = buildRuntime(env);
  }
  return runtimePromise;
}

/**
 * Development mode is an explicit decision (spec 069), never "the secret is missing": Nitro replaces
 * `import.meta.dev` with `true` only under the Analog dev server (`pnpm dev`) and with `false` in every
 * build — deployed, or previewed with `wrangler pages dev`. A build without `AUTH_SECRET` (at least 32
 * bytes) therefore refuses to start instead of signing sessions with Forge's public dev secret.
 */
const AUTH_DEV_MODE = import.meta.dev === true;

/**
 * Builds an unseeded runtime. Exported for tests, which seed (or not) as each case needs — and which,
 * running outside Nitro, pass `{ devMode: true }` explicitly.
 */
export function createRuntime(env?: ServerEnv, options: { devMode?: boolean } = {}): DemoRuntime {
  const database = env?.DB ? new D1DatabaseAdapter() : new InMemoryDatabaseAdapter();
  // `publicUrlBase` is the path `routes/api/media/[...key].get.ts` serves. It is the adapter's
  // default too, but stating it here keeps the two ends of that contract in one place.
  const storage = env?.BUCKET
    ? new R2StorageAdapter({ publicUrlBase: '/api/media' })
    : new InMemoryStorageAdapter();
  const auth = new UsersCollectionAuthAdapter({
    devMode: options.devMode ?? AUTH_DEV_MODE
  }).init({
    ...env,
    userDatabase: database
  });

  const runtime = new ForgeCmsRuntime<ServerEnv, DemoCollections>({
    collections,
    adapters: { database, auth, storage },
    ...(env !== undefined && { env })
  });

  runtime.init();
  // Hooks get no handle on the CMS (finding 23), and the demo's limits need to count documents.
  setRuntimeRef(runtime as unknown as ForgeCmsRuntime<never>);
  return runtime;
}

async function buildRuntime(env?: ServerEnv): Promise<DemoRuntime> {
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
