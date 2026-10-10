import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import type { AuthUser } from '@forge-cms/auth';
import { ATOMIC_WRITE_MAX_OPERATIONS, LibSqlDatabaseAdapter } from '@forge-cms/db';
import type { AtomicWriteOperation } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { countCalls } from './counting.js';
import type { CountingDatabase } from './counting.js';
import { COLLECTIONS, generateDataset } from './dataset.js';

export const ADMIN_TOKEN = 'perf-admin-token';
export const ADMIN: AuthUser = { id: 'perf-admin', role: 'admin' } as AuthUser;

export interface Fixture {
  runtime: ForgeCmsRuntime;
  database: CountingDatabase;
  storage: InMemoryStorageAdapter;
  /** Directory holding the on-disk libSQL file; removed by {@link Fixture.dispose}. */
  directory: string;
  dispose(): void;
}

/**
 * Builds the fixture: an on-disk libSQL database (a real portable SQL adapter, deterministic and local),
 * the in-memory storage adapter (Forge's upload overhead, not a network provider) and a runtime over them.
 * The dataset is loaded through `atomicWrite` batches — one transaction per 25 documents — so loading a
 * couple of thousand documents costs a second or two, not a second per document.
 */
export async function createFixture(options: { load?: boolean } = {}): Promise<Fixture> {
  const directory = mkdtempSync(join(tmpdir(), 'forge-perf-'));
  const inner = new LibSqlDatabaseAdapter(`file:${join(directory, 'forge.db')}`);
  inner.init();
  const database = countCalls(inner);

  const auth = new InMemoryAuthAdapter();
  auth.registerSession(ADMIN_TOKEN, { user: ADMIN });
  const storage = new InMemoryStorageAdapter();
  const runtime = new ForgeCmsRuntime({
    collections: COLLECTIONS,
    adapters: { database: database.database, auth, storage }
  });
  runtime.init();
  await runtime.syncSchema();

  if (options.load !== false) await loadDataset(database);
  database.reset();

  return {
    runtime,
    database,
    storage,
    directory,
    dispose: () => rmSync(directory, { recursive: true, force: true })
  };
}

export async function loadDataset(database: CountingDatabase): Promise<void> {
  const data = generateDataset();
  const batches: AtomicWriteOperation[] = [];
  const flush = async (): Promise<void> => {
    if (batches.length === 0) return;
    await database.database.atomicWrite(batches.splice(0, batches.length));
  };
  for (const [collection, rows] of [
    ['authors', data.authors],
    ['tags', data.tags],
    ['media', data.media],
    ['posts', data.posts]
  ] as const) {
    for (const row of rows) {
      batches.push({ type: 'create', collection, data: row });
      if (batches.length === ATOMIC_WRITE_MAX_OPERATIONS) await flush();
    }
    await flush();
  }
}
