import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { DatabaseAuthThrottle, ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { collections } from './collections';

export interface ServerEnv {
  /** At least 32 bytes of randomness; signs the session tokens. */
  AUTH_SECRET?: string;
}

interface Server {
  runtime: ForgeCmsRuntime<ServerEnv>;
  /** Login/signup attempt limits, kept in the same database (10 per client, 30 per account, per minute). */
  authThrottle: DatabaseAuthThrottle;
}

let serverPromise: Promise<Server> | undefined;

/** Built on the first request (not at module load) and shared afterwards. */
export async function getServerRuntime(): Promise<ForgeCmsRuntime<ServerEnv>> {
  return (await getServer()).runtime;
}

/** The login/signup limiter; its counters live in the runtime's own database. */
export async function getAuthThrottle(): Promise<DatabaseAuthThrottle> {
  return (await getServer()).authThrottle;
}

function getServer(): Promise<Server> {
  serverPromise ??= buildServer();
  return serverPromise;
}

async function buildServer(): Promise<Server> {
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

  const authThrottle = new DatabaseAuthThrottle({ database });
  await authThrottle.syncSchema();
  return { runtime, authThrottle };
}
