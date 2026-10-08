import type { Client } from '@libsql/client';
import {
  ApiKeyAuthAdapter,
  CompositeAuthAdapter,
  UsersCollectionAuthAdapter
} from '@forge-cms/auth';
import type { DatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import type { PutObjectOptions, StorageAdapter, StorageObject } from '@forge-cms/storage';
import { collections, globals } from './model.js';

/** Test-only secret for the *current* runtime (≥ 32 bytes, spec 069). Never in a backup manifest. */
export const REHEARSAL_AUTH_SECRET = 'rehearsal-only-auth-secret-0123456789abcdef';

/**
 * Delegates to a real storage adapter and can be told to fail deletes — the one fault the rehearsal
 * injects, to leave a real pending storage intent (spec 067) in the database it backs up.
 */
export class SwitchableStorage implements StorageAdapter {
  readonly name: string;
  failDeletes = false;

  constructor(readonly inner: StorageAdapter) {
    this.name = inner.name;
  }
  init(env?: unknown): this {
    this.inner.init(env);
    return this;
  }
  put(options: PutObjectOptions): Promise<StorageObject> {
    return this.inner.put(options);
  }
  get(key: string): Promise<StorageObject | null> {
    return this.inner.get(key);
  }
  async delete(key: string): Promise<void> {
    if (this.failDeletes) throw new Error(`injected storage outage deleting ${key}`);
    await this.inner.delete(key);
  }
  getPublicUrl(key: string): Promise<string> {
    return this.inner.getPublicUrl(key);
  }
  list(prefix?: string): Promise<StorageObject[]> {
    return this.inner.list(prefix);
  }
}

/** One running installation the rehearsal verifies: the current ForgeCMS over some environment. */
export interface Installation {
  profile: 'libsql' | 'libsql-s3' | 'd1-r2';
  runtime: ForgeCmsRuntime;
  users: UsersCollectionAuthAdapter;
  apiKeys: ApiKeyAuthAdapter;
  storage: SwitchableStorage;
  /** Read-only SQL for exact counts and raw stored representations. */
  sql(query: string): Promise<Record<string, unknown>[]>;
}

/**
 * The application's server wiring, exactly as a consumer writes it with the public packages: users +
 * API keys behind one composite auth adapter, all on the runtime's database. `env` carries the
 * platform bindings (D1/R2) when there are any.
 */
export function createInstallation(options: {
  profile: Installation['profile'];
  database: DatabaseAdapter;
  storage: StorageAdapter;
  bindings?: Record<string, unknown>;
  sql: Installation['sql'];
}): Installation {
  const users = new UsersCollectionAuthAdapter();
  const apiKeys = new ApiKeyAuthAdapter();
  const storage = new SwitchableStorage(options.storage);
  const runtime = new ForgeCmsRuntime({
    env: {
      ...options.bindings,
      AUTH_SECRET: REHEARSAL_AUTH_SECRET,
      userDatabase: options.database,
      apiKeyDatabase: options.database
    },
    collections,
    globals,
    adapters: {
      database: options.database,
      auth: new CompositeAuthAdapter([users, apiKeys]),
      storage
    }
  }).init();
  return { profile: options.profile, runtime, users, apiKeys, storage, sql: options.sql };
}

export function libsqlRows(client: Client): Installation['sql'] {
  return async (query) => {
    const result = await client.execute(query);
    return result.rows.map((row) =>
      Object.fromEntries(result.columns.map((column) => [column, row[column]]))
    );
  };
}
