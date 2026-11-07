import '@strata-sc/server-components/server-only';

import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { D1DatabaseAdapter } from '@forge-cms/cloudflare';
import type { D1Database } from '@forge-cms/cloudflare';
import { InMemoryDatabaseAdapter, LibSqlDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

import { collections } from './collections';

export interface EditorialEnv {
  /** Cloudflare D1 binding: selects the Cloudflare profile. */
  DB?: D1Database;
  /** libSQL URL (`file:/srv/editorial.db`, `libsql://…`): selects the portable Node profile. */
  DATABASE_URL?: string;
  /** Session signing secret, at least 32 bytes. Required outside `vite` dev. */
  AUTH_SECRET?: string;
}

export type EditorialRuntime = ForgeCmsRuntime<EditorialEnv>;
export type ProfileName = 'cloudflare' | 'portable' | 'development';

/**
 * Exactly one durable profile in production, or a startup error. In-memory persistence is reachable only
 * under the Vite dev server (`import.meta.dev`), never in a build: a misconfigured deployment refuses to
 * start instead of silently losing editorial data. Messages name variables, never values.
 *
 * No collection here uploads files, so the storage adapter holds nothing and makes no durability claim.
 */
export function resolveProfile(env: EditorialEnv, development: boolean): ProfileName {
  const hasD1 = env.DB !== undefined && env.DB !== null;
  const hasLibsql = typeof env.DATABASE_URL === 'string' && env.DATABASE_URL.trim() !== '';
  if (hasD1 && hasLibsql) {
    throw new Error(
      'Editorial profile is ambiguous: set either DB (D1) or DATABASE_URL (libSQL), not both.'
    );
  }
  if (hasD1) return 'cloudflare';
  if (hasLibsql) return 'portable';
  if (development) return 'development';
  throw new Error('No durable editorial profile: set DB (Cloudflare D1) or DATABASE_URL (libSQL).');
}

/**
 * One runtime per isolate, shared by the Nitro bundle (controllers, native routes) and the Angular SSR
 * bundle (Server Components). Strata documents that those bundles evaluate separate module copies, so a
 * module-local variable would build TWO runtimes (two libSQL connections, or two diverging in-memory
 * databases in dev). `Symbol.for` resolves to the same key in both copies and never crosses an isolate.
 *
 * This holds infrastructure only (adapters, schema). It never holds request state: the caller's identity
 * is derived from each request's own headers by `EditorialService.resolveEditor`.
 */
const RUNTIME_KEY = Symbol.for('forge-strata-editorial.runtime');
type RuntimeStore = { promise?: Promise<EditorialRuntime> };
const store = ((globalThis as Record<symbol, unknown>)[RUNTIME_KEY] ??= {}) as RuntimeStore;

export function getEditorialRuntime(env: EditorialEnv): Promise<EditorialRuntime> {
  store.promise ??= buildRuntime(env).catch((error: unknown) => {
    // A failed start (bad profile, unreachable database) must not poison the isolate forever.
    store.promise = undefined;
    throw error;
  });
  return store.promise;
}

let developmentOverride: boolean | undefined;

/** Test-only: drop the isolate's runtime; `development: true` lets a unit test run in memory. */
export function resetEditorialRuntimeForTests(options: { development?: boolean } = {}): void {
  store.promise = undefined;
  developmentOverride = options.development;
}

/** `import.meta.dev` is `true` only under the Vite dev server and `false` in every build. */
const isDevelopment = (): boolean =>
  developmentOverride ?? (import.meta as { dev?: boolean }).dev === true;

async function buildRuntime(env: EditorialEnv): Promise<EditorialRuntime> {
  const development = isDevelopment();
  const profile = resolveProfile(env, development);
  const database =
    profile === 'cloudflare'
      ? new D1DatabaseAdapter()
      : profile === 'portable'
        ? new LibSqlDatabaseAdapter(env.DATABASE_URL ?? '')
        : new InMemoryDatabaseAdapter();

  const auth = new UsersCollectionAuthAdapter({ devMode: development }).init({
    ...env,
    userDatabase: database
  });
  const runtime = new ForgeCmsRuntime<EditorialEnv>({
    collections,
    adapters: { database, auth, storage: new InMemoryStorageAdapter() },
    env
  });
  runtime.init();
  await runtime.syncSchema();
  return runtime;
}

/** The Node profile's configuration: only the keys this app reads, from the process environment. */
export function nodeEnv(): EditorialEnv {
  const env: EditorialEnv = {};
  const source = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  if (source?.['DATABASE_URL'] !== undefined) env.DATABASE_URL = source['DATABASE_URL'];
  if (source?.['AUTH_SECRET'] !== undefined) env.AUTH_SECRET = source['AUTH_SECRET'];
  return env;
}
