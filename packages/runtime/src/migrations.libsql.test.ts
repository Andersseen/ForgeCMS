import { afterAll, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { defineCollection, defineField } from '@forge-cms/core';
import { InMemoryDatabaseAdapter, LibSqlDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import {
  runMigrationContractTests,
  type MigrationBatchHook,
  type MigrationContractRuntime
} from '@forge-cms/testing/contracts';
import type { CollectionDefinition } from '@forge-cms/core';
import type { DatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from './runtime.js';

// Spec 072 — reviewed migrations through `ForgeCmsRuntime` on a real on-disk libSQL file. Every
// `open()` is a new runtime over a new `LibSqlDatabaseAdapter` (its own client and SQLite connection) on
// the same file: a separate deploy process.

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};
const os = (await import(/* @vite-ignore */ 'node:os' as string)) as { tmpdir(): string };
const directory = fs.mkdtempSync(`${os.tmpdir()}/forge-runtime-migrations-`);
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
let files = 0;

function runtimeOver(database: DatabaseAdapter, collections: CollectionDefinition[]) {
  return new ForgeCmsRuntime({
    collections,
    adapters: {
      database,
      auth: new InMemoryAuthAdapter(),
      storage: new InMemoryStorageAdapter()
    }
  }).init();
}

/**
 * The adapter builds its client internally; the transport hook wraps that client's `batch` — the one
 * call every schema/migration batch goes through. Test-only reach into a private field.
 */
function hookBatches(adapter: LibSqlDatabaseAdapter, hook: MigrationBatchHook): void {
  const client = (adapter as unknown as { client: Client }).client;
  const batch = client.batch.bind(client);
  client.batch = (async (statements: Parameters<Client['batch']>[0], mode) => {
    let result: Awaited<ReturnType<Client['batch']>> = [];
    const sqls = statements.map((s) =>
      typeof s === 'string' ? s : Array.isArray(s) ? s[0] : s.sql
    );
    await hook(sqls, async () => {
      result = await batch(statements, mode);
    });
    return result;
  }) as Client['batch'];
}

runMigrationContractTests('LibSqlDatabaseAdapter (on-disk file) via ForgeCmsRuntime', () => {
  const url = `file:${directory}/migrations-${++files}.db`;
  const raw = createClient({ url });
  return Promise.resolve({
    open: (collections, hook) => {
      const adapter = new LibSqlDatabaseAdapter(url);
      const runtime = runtimeOver(adapter, collections); // init() creates the adapter's client
      if (hook) hookBatches(adapter, hook);
      return Promise.resolve(runtime as unknown as MigrationContractRuntime);
    },
    query: async (sql) => (await raw.execute(sql)).rows.map((row) => ({ ...row })),
    exec: async (sql) => {
      await raw.execute(sql);
    }
  });
});

describe('ForgeCmsRuntime migrations — adapters without the capability (spec 072)', () => {
  it('InMemory refuses explicitly instead of pretending success', async () => {
    const runtime = runtimeOver(new InMemoryDatabaseAdapter(), [
      defineCollection({ slug: 'posts', fields: { title: defineField.text() } })
    ]);
    const migration = {
      id: '001',
      description: 'd',
      destructive: false,
      statements: [{ sql: 'SELECT 1' }]
    };
    await expect(runtime.runMigrations([migration])).rejects.toMatchObject({
      code: 'MIGRATION_UNSUPPORTED'
    });
    await expect(runtime.readMigrationHistory()).rejects.toMatchObject({
      code: 'MIGRATION_UNSUPPORTED'
    });
  });

  it('an invalid definition is refused before any database access', async () => {
    const runtime = runtimeOver(new InMemoryDatabaseAdapter(), []);
    await expect(
      runtime.runMigrations([{ id: 'x', description: 'd', destructive: false, statements: [] }])
    ).rejects.toMatchObject({ code: 'MIGRATION_INVALID', phase: 'validate' });
  });
});
