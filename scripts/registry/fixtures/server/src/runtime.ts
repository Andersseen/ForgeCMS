import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { LibSqlDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { collections, globals } from './collections.js';

export interface Env {
  AUTH_SECRET: string;
}

export async function createRuntime() {
  const env: Env = { AUTH_SECRET: process.env['AUTH_SECRET'] ?? '' };
  const database = new LibSqlDatabaseAdapter(process.env['DATABASE_URL'] ?? 'file:./forge.db');
  const auth = new UsersCollectionAuthAdapter().init({ ...env, userDatabase: database });
  const runtime = new ForgeCmsRuntime<Env>({
    collections,
    globals,
    adapters: { database, auth, storage: new InMemoryStorageAdapter() },
    env
  });
  runtime.init();
  await runtime.syncSchema();
  return { runtime, auth, env };
}
