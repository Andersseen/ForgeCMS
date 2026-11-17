import { PASSWORD_HASHING_PRESETS, UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { LibSqlDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { collections } from './collections.js';

export interface ServerEnv {
  /** At least 32 bytes of randomness; signs the session tokens. */
  AUTH_SECRET?: string;
  /** A libSQL URL, for example `file:./forge.db`. */
  DATABASE_URL?: string;
}

export async function createRuntime(env: ServerEnv) {
  const database = new LibSqlDatabaseAdapter(env.DATABASE_URL ?? 'file:./forge.db');
  // A Node server: the stronger password work factor (600 000 PBKDF2 iterations, ≈ 45 ms per login).
  // On Cloudflare Workers keep the default (100 000), sized for the Free plan's 10 ms CPU limit.
  const auth = new UsersCollectionAuthAdapter({
    passwordHashing: PASSWORD_HASHING_PRESETS.node
  }).init({
    ...(env.AUTH_SECRET !== undefined && { AUTH_SECRET: env.AUTH_SECRET }),
    userDatabase: database
  });

  const runtime = new ForgeCmsRuntime<ServerEnv>({
    collections,
    adapters: { database, auth, storage: new InMemoryStorageAdapter() },
    env
  });

  runtime.init();
  // Creates missing tables and adds new optional columns. Anything riskier throws SchemaDriftError.
  await runtime.syncSchema();

  return { runtime, auth };
}
