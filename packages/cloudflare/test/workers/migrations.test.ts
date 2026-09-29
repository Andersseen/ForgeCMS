import { env } from 'cloudflare:workers';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import {
  runMigrationContractTests,
  type MigrationBatchHook,
  type MigrationContractRuntime
} from '@forge-cms/testing/contracts';
import type { CollectionDefinition } from '@forge-cms/core';
import type { D1Database, D1PreparedStatement } from '../../src/bindings.js';
import { D1DatabaseAdapter } from '../../src/d1.adapter.js';

// Spec 072 — the reviewed migration contract on the real local D1 binding (workerd). Every `open()` is
// a new `ForgeCmsRuntime` over a new `D1DatabaseAdapter` on the one binding — as independent as two
// Worker isolates or deploy processes are from the code's point of view. Local evidence, not production.
//
// `@cloudflare/vitest-plugin` isolates D1 storage per test file, not per test, and the migration ledger
// is database-wide, so each harness starts by dropping every table this file created.

/** Statement wrapper that remembers its SQL, so the batch hook can see what a batch contains. */
class TrackedStatement implements D1PreparedStatement {
  constructor(
    readonly native: D1PreparedStatement,
    readonly sql: string
  ) {}
  bind(...values: unknown[]): D1PreparedStatement {
    return new TrackedStatement(this.native.bind(...values), this.sql);
  }
  first<T = unknown>(colName?: string) {
    return colName === undefined ? this.native.first<T>() : this.native.first<T>(colName);
  }
  run<T = unknown>() {
    return this.native.run<T>();
  }
  all<T = unknown>() {
    return this.native.all<T>();
  }
  raw<T = unknown>() {
    return this.native.raw<T>();
  }
}

function hooked(db: D1Database, hook: MigrationBatchHook): D1Database {
  return {
    prepare: (sql) => new TrackedStatement(db.prepare(sql), sql),
    exec: (sql) => db.exec(sql),
    async batch<T = unknown>(statements: D1PreparedStatement[]) {
      const tracked = statements as TrackedStatement[];
      let results: Awaited<ReturnType<D1Database['batch']>> = [];
      await hook(
        tracked.map((s) => s.sql),
        async () => {
          results = await db.batch<T>(tracked.map((s) => s.native));
        }
      );
      return results as Awaited<ReturnType<D1Database['batch']>> as never;
    }
  };
}

async function resetDatabase(): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" NOT LIKE 'sqlite_%' ` +
      `AND "name" NOT LIKE '_cf_%'`
  ).all<{ name: string }>();
  for (const { name } of results) await env.DB.prepare(`DROP TABLE "${name}"`).run();
}

runMigrationContractTests(
  'D1DatabaseAdapter (real local D1 binding) via ForgeCmsRuntime',
  async () => {
    await resetDatabase();
    return {
      open: (collections: CollectionDefinition[], hook?: MigrationBatchHook) => {
        const runtimeEnv = { DB: hook ? hooked(env.DB, hook) : env.DB };
        const runtime = new ForgeCmsRuntime({
          env: runtimeEnv,
          collections,
          adapters: {
            database: new D1DatabaseAdapter(),
            auth: new InMemoryAuthAdapter(),
            storage: new InMemoryStorageAdapter()
          }
        }).init();
        return Promise.resolve(runtime as unknown as MigrationContractRuntime);
      },
      query: async (sql: string) =>
        (await env.DB.prepare(sql).all<Record<string, unknown>>()).results,
      exec: async (sql: string) => {
        await env.DB.prepare(sql).run();
      }
    };
  }
);
