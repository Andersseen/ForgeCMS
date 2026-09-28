import { afterAll, describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { defineCollection, defineField, defineGlobal } from '@forge-cms/core';
import type { CollectionDefinition, FieldMap, GlobalDefinition } from '@forge-cms/core';
import {
  InMemoryDatabaseAdapter,
  LibSqlDatabaseAdapter,
  formatSchemaPlan,
  isSchemaDriftError
} from '@forge-cms/db';
import type { DatabaseAdapter, SchemaPlan } from '@forge-cms/db';
import {
  ApiKeyAuthAdapter,
  CompositeAuthAdapter,
  InMemoryAuthAdapter,
  UsersCollectionAuthAdapter,
  defineUsersCollection
} from '@forge-cms/auth';
import type { AuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';

// Spec 070 — the runtime plans every table it and its auth adapter own before touching any of them.

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};
const os = (await import(/* @vite-ignore */ 'node:os' as string)) as { tmpdir(): string };
const directory = fs.mkdtempSync(`${os.tmpdir()}/forge-runtime-drift-`);
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
let files = 0;
const newUrl = () => `file:${directory}/runtime-${++files}.db`;

const t = defineField.text;

function authFor(database: DatabaseAdapter): AuthAdapter {
  return new CompositeAuthAdapter([
    new UsersCollectionAuthAdapter({ devMode: true }),
    new ApiKeyAuthAdapter()
  ]).init({ userDatabase: database, apiKeyDatabase: database });
}

function runtimeOver(
  database: DatabaseAdapter,
  collections: CollectionDefinition[],
  globals: GlobalDefinition[] = [],
  auth: AuthAdapter = authFor(database)
): ForgeCmsRuntime {
  const runtime = new ForgeCmsRuntime({
    collections,
    globals,
    adapters: { database, auth, storage: new InMemoryStorageAdapter() }
  });
  // `init()` would re-run auth init with the (empty) runtime env; the adapters are initialised here.
  database.init();
  return runtime;
}

async function columns(url: string, table: string): Promise<string[]> {
  const client = createClient({ url });
  const result = await client.execute({
    sql: 'SELECT "name" FROM pragma_table_info(?) ORDER BY "cid"',
    args: [table]
  });
  client.close();
  return result.rows.map((r) => String(r.name));
}

async function raw(url: string, sql: string): Promise<void> {
  const client = createClient({ url });
  await client.execute(sql);
  client.close();
}

const users = defineUsersCollection();
const media = defineCollection({ slug: 'media', upload: true, fields: { alt: t() } });
const posts = (extra: Record<string, ReturnType<typeof t>> = {}) =>
  defineCollection({
    slug: 'posts',
    versions: true,
    drafts: true,
    fields: { title: t({ required: true }), ...extra }
  });
const site = (fields: FieldMap = { title: t() }) => defineGlobal({ slug: 'site', fields });

describe('ForgeCmsRuntime.planSchema() / syncSchema() — spec 070', () => {
  it('a fresh database: every table the runtime and auth own is planned as safe-additive, then empty', async () => {
    const url = newUrl();
    const database = new LibSqlDatabaseAdapter(url);
    const runtime = runtimeOver(database, [users, media, posts()], [site()]);

    const plan = await runtime.planSchema();
    expect(plan.blocking).toBe(false);
    expect(plan.changes.map((c) => [c.table, c.kind])).toEqual([
      ['_forge_api_keys', 'table-added'],
      ['_forge_bootstrap', 'table-added'],
      ['_forge_schema', 'table-added'],
      ['_forge_storage_intents', 'table-added'],
      ['_global_site', 'table-added'],
      ['_versions_posts', 'table-added'],
      ['media', 'table-added'],
      ['posts', 'table-added'],
      ['users', 'table-added']
    ]);

    await runtime.syncSchema();
    const again = runtimeOver(new LibSqlDatabaseAdapter(url), [users, media, posts()], [site()]);
    expect((await again.planSchema()).changes).toEqual([]);
    // Re-syncing an unchanged database is a no-op, not an error.
    await again.syncSchema();
  });

  it('plan before mutation across areas: a blocking global leaves a safe collection change unapplied', async () => {
    const url = newUrl();
    await runtimeOver(new LibSqlDatabaseAdapter(url), [users, posts()], [site()]).syncSchema();

    const next = runtimeOver(
      new LibSqlDatabaseAdapter(url),
      [users, posts({ summary: t() })],
      [site({ title: defineField.number() })]
    );
    const error = await next.syncSchema().catch((e: unknown) => e);
    expect(isSchemaDriftError(error)).toBe(true);
    const plan = (error as { plan: SchemaPlan }).plan;
    expect(plan.changes.map((c) => [c.table, c.kind, c.classification])).toEqual([
      ['_global_site', 'column-type-changed', 'manual-migration'],
      ['posts', 'column-added', 'safe-additive']
    ]);
    expect(await columns(url, 'posts')).not.toContain('summary');
  });

  it("the auth adapter's internal tables are planned too: API-key drift stops every other change", async () => {
    const url = newUrl();
    await runtimeOver(new LibSqlDatabaseAdapter(url), [users, posts()]).syncSchema();
    await raw(url, 'CREATE UNIQUE INDEX "stray_api_key_name" ON "_forge_api_keys" ("name")');

    const next = runtimeOver(new LibSqlDatabaseAdapter(url), [users, posts({ summary: t() })]);
    const plan = await next.planSchema();
    expect(plan.changes.map((c) => [c.table, c.kind, c.target.name, c.classification])).toEqual([
      ['_forge_api_keys', 'index-removed', 'stray_api_key_name', 'manual-migration'],
      ['posts', 'column-added', 'summary', 'safe-additive']
    ]);
    await expect(next.syncSchema()).rejects.toMatchObject({ code: 'SCHEMA_DRIFT' });
    expect(await columns(url, 'posts')).not.toContain('summary');
  });

  it('bootstrap, storage-intent and version tables report drift like any other table', async () => {
    const url = newUrl();
    await runtimeOver(new LibSqlDatabaseAdapter(url), [users, media, posts()]).syncSchema();
    await raw(url, 'ALTER TABLE "_forge_bootstrap" ADD COLUMN "legacy" TEXT');
    await raw(url, 'DROP INDEX "idx__forge_storage_intents_key"');
    await raw(url, 'ALTER TABLE "_versions_posts" ADD COLUMN "old" TEXT');

    const plan = await runtimeOver(new LibSqlDatabaseAdapter(url), [
      users,
      media,
      posts()
    ]).planSchema();
    expect(plan.changes.map((c) => [c.table, c.kind, c.target.name, c.classification])).toEqual([
      ['_forge_bootstrap', 'column-removed', 'legacy', 'manual-migration'],
      ['_forge_storage_intents', 'index-added', 'idx__forge_storage_intents_key', 'safe-additive'],
      ['_versions_posts', 'column-removed', 'old', 'manual-migration']
    ]);
    expect(formatSchemaPlan(plan)).toContain(
      '_forge_bootstrap.legacy  column-removed  [manual-migration]'
    );
  });

  it('a users table from before spec 061 gains _sessionVersion automatically (optional, nullable)', async () => {
    const url = newUrl();
    await raw(
      url,
      'CREATE TABLE "users" ("id" TEXT PRIMARY KEY, "created_at" TEXT, "updated_at" TEXT, "email" TEXT, "name" TEXT, "role" TEXT, "passwordHash" TEXT)'
    );
    await raw(url, 'CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email")');
    await raw(
      url,
      `INSERT INTO "users" ("id", "email", "role") VALUES ('u1', 'a@example.com', 'admin')`
    );

    const runtime = runtimeOver(new LibSqlDatabaseAdapter(url), [users]);
    const plan = await runtime.planSchema();
    expect(
      plan.changes.filter((c) => c.table === 'users').map((c) => [c.kind, c.classification])
    ).toEqual([
      ['baseline-recorded', 'informational'],
      ['column-added', 'safe-additive']
    ]);
    await runtime.syncSchema();
    expect(await columns(url, 'users')).toContain('_sessionVersion');
  });

  it('refuses to call an uninspectable schema compatible; syncSchema keeps the adapter’s own behaviour', async () => {
    const database = new InMemoryDatabaseAdapter();
    const legacy = new Proxy(database, {
      get(target, property) {
        if (property === 'planSchema') return undefined;
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      }
    });
    const runtime = runtimeOver(legacy, [posts()], [], new InMemoryAuthAdapter());
    await expect(runtime.planSchema()).rejects.toThrow(/cannot inspect its persisted schema/);
    await expect(runtime.syncSchema()).resolves.toBeUndefined();
  });

  it('InMemory persists nothing, so its plan is always empty', async () => {
    const runtime = runtimeOver(
      new InMemoryDatabaseAdapter(),
      [posts()],
      [site()],
      new InMemoryAuthAdapter()
    );
    await expect(runtime.planSchema()).resolves.toEqual({ changes: [], blocking: false });
  });
});
