import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
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
  const auth = new UsersCollectionAuthAdapter().init({
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
