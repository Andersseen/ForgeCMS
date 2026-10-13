import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { collections } from './collections';

export interface ServerEnv {
  /** At least 32 bytes of randomness; signs the session tokens. */
  AUTH_SECRET?: string;
}

let runtimePromise: Promise<ForgeCmsRuntime<ServerEnv>> | undefined;

/** Built on the first request (not at module load) and shared afterwards. */
export function getServerRuntime(): Promise<ForgeCmsRuntime<ServerEnv>> {
  runtimePromise ??= buildRuntime();
  return runtimePromise;
}

async function buildRuntime(): Promise<ForgeCmsRuntime<ServerEnv>> {
  const env: ServerEnv = {};
  const secret = process.env['AUTH_SECRET'];
  if (secret !== undefined) env.AUTH_SECRET = secret;

  // DEVELOPMENT ADAPTERS: everything is lost when the server restarts. A real deployment uses a durable
  // profile (D1 + R2, or libSQL + S3) — see the Deployment guide.
  const database = new InMemoryDatabaseAdapter();
  const auth = new UsersCollectionAuthAdapter().init({ ...env, userDatabase: database });

  const runtime = new ForgeCmsRuntime<ServerEnv>({
    collections,
    adapters: { database, auth, storage: new InMemoryStorageAdapter() },
    env
  });

  runtime.init();
  await runtime.syncSchema();
  return runtime;
}
