import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import type { CollectionDefinition } from '@forge-cms/core';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { runVersionHistoryContractTests } from '@forge-cms/testing/contracts';
import { D1DatabaseAdapter } from '../../src/d1.adapter.js';

// Spec 062's real-D1 evidence, inside workerd against Miniflare's local D1 (SQLite). Every contender is
// its own `ForgeCmsRuntime` over its own `D1DatabaseAdapter` on the one shared binding — as independent
// as two Worker isolates are from the code's point of view. Each test uses its own collection, so the
// per-file D1 storage needs no cleanup. This is local workerd evidence, not production D1.

function historyCollection(slug: string): CollectionDefinition {
  return defineCollection({
    slug,
    versions: true,
    fields: {
      title: defineField.text({ required: true }),
      body: defineField.text(),
      tag: defineField.text()
    }
  });
}

function runtimeOver(database: D1DatabaseAdapter | object, collections: CollectionDefinition[]) {
  const runtime = new ForgeCmsRuntime({
    env,
    collections,
    adapters: {
      database: database as D1DatabaseAdapter,
      auth: new InMemoryAuthAdapter(),
      storage: new InMemoryStorageAdapter()
    }
  });
  runtime.init();
  return runtime;
}

describe('D1DatabaseAdapter — real local D1 binding: document / version history consistency', () => {
  runVersionHistoryContractTests(
    async ({ collection, parties, gate }) => {
      const contenders = [];
      for (let i = 0; i < parties; i++) {
        const runtime = runtimeOver(gate.wrap(new D1DatabaseAdapter().init(env)), [
          historyCollection(collection)
        ]);
        await runtime.syncSchema();
        contenders.push(runtime);
      }
      const raw = runtimeOver(new D1DatabaseAdapter().init(env), [historyCollection(collection)]);
      await raw.syncSchema();
      return { contenders, database: raw.adapters.database };
    },
    {
      // A real database-side failure of the snapshot INSERT that is not a constraint violation.
      failSnapshotInserts: async (versionsCollection) => {
        await env.DB.prepare(
          `CREATE TRIGGER "fail_${versionsCollection}" BEFORE INSERT ON "${versionsCollection}" ` +
            `BEGIN SELECT RAISE(ABORT, 'injected snapshot failure'); END`
        ).run();
        return async () => {
          await env.DB.prepare(`DROP TRIGGER "fail_${versionsCollection}"`).run();
        };
      }
    }
  );
});

describe('D1DatabaseAdapter — real local D1 binding: upgrading a pre-062 version table', () => {
  /** The exact table a pre-062 `syncSchema()` created: no `snapshotFormat`, no unique index. */
  async function seedOldTable(slug: string, rows: [string, string, number, string][]) {
    await env.DB.prepare(
      `CREATE TABLE "${slug}" ("id" TEXT PRIMARY KEY, "created_at" TEXT, "updated_at" TEXT, "title" TEXT, "body" TEXT, "tag" TEXT)`
    ).run();
    await env.DB.prepare(
      `CREATE TABLE "_versions_${slug}" ("id" TEXT PRIMARY KEY, "created_at" TEXT, "updated_at" TEXT, "documentId" TEXT, "versionNumber" REAL, "data" TEXT, "createdAt" TEXT, "createdBy" TEXT, "autosave" INTEGER, "label" TEXT)`
    ).run();
    for (const [id, documentId, versionNumber, data] of rows) {
      await env.DB.prepare(
        `INSERT INTO "_versions_${slug}" ("id", "documentId", "versionNumber", "data", "createdAt") VALUES (?, ?, ?, ?, ?)`
      )
        .bind(id, documentId, versionNumber, data, '2026-01-01T00:00:00.000Z')
        .run();
    }
  }

  it('historical duplicates: syncSchema fails loudly and leaves every row untouched', async () => {
    await seedOldTable('legacy_dupes', [
      ['a', 'd1', 1, '{"title":"one"}'],
      ['b', 'd1', 2, '{"title":"two"}'],
      ['c', 'd1', 2, '{"title":"two again"}']
    ]);

    const runtime = runtimeOver(new D1DatabaseAdapter().init(env), [
      historyCollection('legacy_dupes')
    ]);
    const error = await runtime.syncSchema().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('1 duplicate version identity');
    expect((error as Error).message).toContain('document "d1" version 2 (2 rows)');

    const { results } = await env.DB.prepare(
      'SELECT "id" FROM "_versions_legacy_dupes" ORDER BY "id"'
    ).all<{ id: string }>();
    expect(results.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('clean history upgrades in place: the unique index is added and old rows stay readable', async () => {
    await seedOldTable('legacy_clean', [
      ['a', 'd1', 1, '{"title":"one"}'],
      ['b', 'd1', 2, '{"title":"patched"}']
    ]);

    const runtime = runtimeOver(new D1DatabaseAdapter().init(env), [
      historyCollection('legacy_clean')
    ]);
    await runtime.syncSchema();

    const { results } = await env.DB.prepare(`PRAGMA index_list("_versions_legacy_clean")`).all<{
      name: string;
      unique: number;
    }>();
    expect(
      results.some(
        (r) => r.name === 'idx__versions_legacy_clean_documentId_versionNumber' && r.unique === 1
      )
    ).toBe(true);
    const history = await runtime.listVersions({ collection: 'legacy_clean', documentId: 'd1' });
    expect(history.map((v) => v.versionNumber)).toEqual([2, 1]);
  });
});
