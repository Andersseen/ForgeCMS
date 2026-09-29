import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import type { CollectionDefinition } from '@forge-cms/core';

// Reviewed migration contract (spec 072, roadmap 0.7 M02). One scenario body for every durable SQLite
// backend (on-disk libSQL, local D1), driven through the runtime's documented entry point. Duck-typed
// on purpose — like every contract here it must not import `@forge-cms/db`/`@forge-cms/runtime`, so the
// migrations below are plain data, exactly as a consumer's deploy script may write them.

type Row = Record<string, unknown>;

interface PlanLike {
  blocking: boolean;
  changes: readonly { table: string; kind: string; classification: string }[];
}

/** A migration definition as plain data (what `defineMigration` validates). */
export interface MigrationLike {
  id: string;
  description: string;
  destructive: boolean;
  statements: { sql: string; args?: (string | number | boolean | null)[] }[];
  resetBaseline?: string[];
}

/** The subset of `ForgeCmsRuntime` under test. */
export interface MigrationContractRuntime {
  syncSchema(): Promise<void>;
  planSchema(): Promise<PlanLike>;
  runMigrations(
    migrations: MigrationLike[],
    options?: { allowDestructive?: boolean; retryFailed?: string; replaceFailed?: string }
  ): Promise<{ before: PlanLike; results: { id: string; outcome: string }[]; after: PlanLike }>;
  planMigrations(migrations: MigrationLike[]): Promise<{ id: string; state: string }[]>;
  readMigrationHistory(): Promise<
    { position: number; id: string; checksum: string; status: string; attempts: number }[]
  >;
  create(args: { collection: string; data: Row }): Promise<Row>;
  findByID(args: { collection: string; id: string; overrideAccess?: boolean }): Promise<Row | null>;
  find(args: { collection: string; overrideAccess?: boolean }): Promise<{ docs: Row[] }>;
}

/**
 * Transport hook: wraps each transactional batch the database adapter sends. `statements` are the SQL
 * texts; `send` executes the real batch. Lets the suite hold a batch (a deterministic race) or lose its
 * response (an outcome to reconcile) without touching Forge internals.
 */
export type MigrationBatchHook = (
  statements: readonly string[],
  send: () => Promise<void>
) => Promise<void>;

export interface MigrationContractHarness {
  /**
   * A **new** runtime (own adapter instance, own connection) over the one persisted database, for
   * `collections` — a new process or deploy. `batch`, when given, wraps every batch of that adapter.
   */
  open(
    collections: CollectionDefinition[],
    batch?: MigrationBatchHook
  ): Promise<MigrationContractRuntime>;
  /** Raw read against the same database. */
  query(sql: string): Promise<Row[]>;
  /** Raw statement against the same database (the operator fixing a cause by hand). */
  exec(sql: string): Promise<void>;
}

/**
 * Builds a harness over a **fresh, empty** database: the ledger is database-wide, so scenarios cannot
 * share one.
 */
export type MigrationContractHarnessFactory = () => Promise<MigrationContractHarness>;

const TEST_TIMEOUT_MS = 30_000;
const t = defineField.text;

/** Whether a batch is a migration's own batch (its `applied` transition), not a schema sync. */
function isMigrationBatch(statements: readonly string[]): boolean {
  return statements.some((s) => s.includes('"_forge_migrations"') && s.includes('"finished_at"'));
}

/** Holds the next migration batch of one runner until released. */
function holdNextMigrationBatch(): {
  hook: MigrationBatchHook;
  reached: Promise<void>;
  release(): void;
} {
  let arrive: () => void = () => {};
  let release: () => void = () => {};
  const reached = new Promise<void>((resolve) => (arrive = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  let armed = true;
  return {
    reached,
    release: () => release(),
    async hook(statements, send) {
      if (armed && isMigrationBatch(statements)) {
        armed = false;
        arrive();
        await gate;
      }
      await send();
    }
  };
}

async function failure(promise: Promise<unknown>): Promise<Row> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
    return err as unknown as Row;
  }
  throw new Error('expected a rejection');
}

function collection(
  slug: string,
  options: Omit<CollectionDefinition, 'slug'>
): CollectionDefinition {
  return defineCollection({ slug, ...options } as CollectionDefinition);
}

export function runMigrationContractTests(
  label: string,
  createHarness: MigrationContractHarnessFactory
): void {
  describe(`${label} — reviewed migration contract (spec 072)`, () => {
    async function columns(h: MigrationContractHarness, table: string): Promise<string[]> {
      return (await h.query(`SELECT "name" FROM pragma_table_info('${table}') ORDER BY "cid"`)).map(
        (r) => String(r.name)
      );
    }

    it(
      'seeded rename: blocked before, reviewed rename after, same ids and values, idempotent re-run',
      async () => {
        const h = await createHarness();
        const v1 = await h.open([collection('posts', { fields: { headline: t() } })]);
        await v1.syncSchema();
        const doc = await v1.create({ collection: 'posts', data: { headline: 'Hello' } });

        const v2 = await h.open([collection('posts', { fields: { title: t() } })]);
        // M01 still refuses, and syncSchema never runs a migration or creates the ledger.
        expect((await failure(v2.syncSchema())).code).toBe('SCHEMA_DRIFT');
        expect(await columns(h, '_forge_migrations')).toEqual([]);

        const rename: MigrationLike = {
          id: '20260929_001_posts_headline_to_title',
          description: 'Rename posts.headline to title',
          destructive: true,
          statements: [{ sql: 'ALTER TABLE "posts" RENAME COLUMN "headline" TO "title"' }]
        };
        expect(await v2.planMigrations([rename])).toEqual([
          expect.objectContaining({ id: rename.id, state: 'pending' })
        ]);
        // Destructive needs explicit approval: nothing ran.
        expect((await failure(v2.runMigrations([rename]))).code).toBe('MIGRATION_REVIEW_REQUIRED');
        expect(await columns(h, 'posts')).toContain('headline');

        const report = await v2.runMigrations([rename], { allowDestructive: true });
        expect(report.before.blocking).toBe(true);
        expect(report.results).toEqual([
          { ...report.results[0], id: rename.id, outcome: 'applied' }
        ]);
        expect(report.after.blocking).toBe(false);
        expect(await columns(h, 'posts')).not.toContain('headline');
        const after = await v2.findByID({ collection: 'posts', id: String(doc.id) });
        expect(after).toMatchObject({ id: doc.id, title: 'Hello' });

        // Duplicate invocation: skipped, no data change, still one ledger row.
        const again = await v2.runMigrations([rename], { allowDestructive: true });
        expect(again.results.map((r) => r.outcome)).toEqual(['already-applied']);
        expect(await h.query('SELECT "id", "title" FROM "posts"')).toEqual([
          { id: doc.id, title: 'Hello' }
        ]);
        const history = await v2.readMigrationHistory();
        expect(history).toEqual([
          expect.objectContaining({ position: 1, id: rename.id, status: 'applied', attempts: 1 })
        ]);
        await v2.syncSchema(); // a normal restart is fine
      },
      TEST_TIMEOUT_MS
    );

    it(
      'required-field backfill: ids and content unchanged, every row populated',
      async () => {
        const h = await createHarness();
        const v1 = await h.open([collection('notes', { fields: { title: t() } })]);
        await v1.syncSchema();
        const a = await v1.create({ collection: 'notes', data: { title: 'A' } });
        const b = await v1.create({ collection: 'notes', data: { title: 'B' } });

        const v2 = await h.open([
          collection('notes', { fields: { title: t(), summary: t({ required: true }) } })
        ]);
        expect((await failure(v2.syncSchema())).code).toBe('SCHEMA_DRIFT');
        const report = await v2.runMigrations([
          {
            id: '001_notes_summary',
            description: 'Add and backfill notes.summary',
            destructive: false,
            statements: [
              { sql: 'ALTER TABLE "notes" ADD COLUMN "summary" TEXT' },
              { sql: 'UPDATE "notes" SET "summary" = ? WHERE "summary" IS NULL', args: ['(none)'] }
            ]
          }
        ]);
        expect(report.after.blocking).toBe(false);
        expect(
          await h.query('SELECT "id", "title", "summary" FROM "notes" ORDER BY "title"')
        ).toEqual([
          { id: a.id, title: 'A', summary: '(none)' },
          { id: b.id, title: 'B', summary: '(none)' }
        ]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'enabling drafts: _status added and backfilled as published; anonymous reads keep every row',
      async () => {
        const h = await createHarness();
        const v1 = await h.open([collection('pages', { fields: { title: t() } })]);
        await v1.syncSchema();
        await v1.create({ collection: 'pages', data: { title: 'Home' } });
        await v1.create({ collection: 'pages', data: { title: 'About' } });

        const v2 = await h.open([collection('pages', { drafts: true, fields: { title: t() } })]);
        expect((await failure(v2.syncSchema())).code).toBe('SCHEMA_DRIFT');
        await v2.runMigrations([
          {
            id: '001_pages_drafts',
            description: 'Enable drafts on pages; existing pages stay published',
            destructive: false,
            statements: [
              { sql: 'ALTER TABLE "pages" ADD COLUMN "_status" TEXT' },
              {
                sql: 'UPDATE "pages" SET "_status" = ? WHERE "_status" IS NULL',
                args: ['published']
              }
            ]
          }
        ]);
        const anonymous = await v2.find({ collection: 'pages', overrideAccess: false });
        expect(anonymous.docs.map((d) => d.title).sort()).toEqual(['About', 'Home']);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'index → unique: duplicates resolved, old index dropped, post-flight sync installs the unique index',
      async () => {
        const h = await createHarness();
        const v1 = await h.open([
          collection('tags', { fields: { slug: defineField.slug({ index: true }) } })
        ]);
        await v1.syncSchema();
        for (const slug of ['a', 'a', 'b']) await v1.create({ collection: 'tags', data: { slug } });

        const v2 = await h.open([
          collection('tags', { fields: { slug: defineField.slug({ unique: true }) } })
        ]);
        expect((await failure(v2.syncSchema())).code).toBe('SCHEMA_DRIFT');
        const [oldIndex] = (
          await h.query(`SELECT "name" FROM pragma_index_list('tags') WHERE "origin" = 'c'`)
        ).map((r) => String(r.name));
        expect(oldIndex).toBeDefined();

        await v2.runMigrations(
          [
            {
              id: '001_tags_slug_unique',
              description: 'Suffix duplicate slugs with the row id, then drop the non-unique index',
              destructive: true,
              statements: [
                {
                  sql:
                    'UPDATE "tags" SET "slug" = "slug" || \'-\' || "id" WHERE EXISTS (SELECT 1 FROM "tags" AS "o" ' +
                    'WHERE "o"."slug" = "tags"."slug" AND "o"."id" < "tags"."id")'
                },
                { sql: `DROP INDEX "${oldIndex}"` }
              ]
            }
          ],
          { allowDestructive: true }
        );
        const indexes = await h.query(
          `SELECT "name", "unique" FROM pragma_index_list('tags') WHERE "origin" = 'c'`
        );
        expect(indexes).toEqual([{ name: oldIndex, unique: 1 }]);
        expect(await h.query('SELECT COUNT(*) AS "n" FROM "tags"')).toEqual([{ n: 3 }]);
        await expect(v2.create({ collection: 'tags', data: { slug: 'b' } })).rejects.toThrow();
      },
      TEST_TIMEOUT_MS
    );

    it(
      'post-flight failure is reported as committed, then a baseline-only migration forward-fixes it',
      async () => {
        const h = await createHarness();
        const v1 = await h.open([collection('docs', { fields: { title: t() } })]);
        await v1.syncSchema();
        const doc = await v1.create({ collection: 'docs', data: { title: 'Hello' } });

        const v2 = await h.open([
          collection('docs', { locales: ['en'], fields: { title: t({ localized: true }) } })
        ]);
        expect((await failure(v2.syncSchema())).code).toBe('SCHEMA_DRIFT');
        const wrap: MigrationLike = {
          id: '001_docs_title_localized',
          description: 'Wrap docs.title under "en" (forgot resetBaseline)',
          destructive: false,
          statements: [
            {
              sql: 'UPDATE "docs" SET "title" = json_object(?, "title") WHERE "title" IS NOT NULL',
              args: ['en']
            }
          ]
        };
        const postflight = await failure(v2.runMigrations([wrap]));
        expect(postflight).toMatchObject({
          code: 'MIGRATION_POSTFLIGHT_FAILED',
          phase: 'postflight',
          status: 'applied'
        });
        expect((postflight.plan as PlanLike).blocking).toBe(true);
        expect(String((postflight as unknown as Error).message)).toMatch(/NOT rolled back/);
        // Committed, not rolled back.
        expect(await h.query('SELECT "title" FROM "docs"')).toEqual([{ title: '{"en":"Hello"}' }]);
        expect((await v2.readMigrationHistory())[0]).toMatchObject({ status: 'applied' });

        const fix: MigrationLike = {
          id: '002_docs_title_baseline',
          description: 'docs.title is localized now; record the new baseline',
          destructive: false,
          statements: [],
          resetBaseline: ['docs']
        };
        const report = await v2.runMigrations([wrap, fix]);
        expect(report.results.map((r) => r.outcome)).toEqual(['already-applied', 'applied']);
        expect(report.after.blocking).toBe(false);
        const read = await v2.findByID({ collection: 'docs', id: String(doc.id) });
        expect(read?.title).toEqual({ en: 'Hello' }); // no locale requested: the whole map
      },
      TEST_TIMEOUT_MS
    );

    const counter = () => [collection('counters', { fields: { n: defineField.number() } })];
    const bump = (id: string, by = 1): MigrationLike => ({
      id,
      description: `Add ${by} to every counter`,
      destructive: false,
      statements: [{ sql: 'UPDATE "counters" SET "n" = "n" + ?', args: [by] }]
    });
    async function counterSetup() {
      const h = await createHarness();
      const setup = await h.open(counter());
      await setup.syncSchema();
      await setup.create({ collection: 'counters', data: { n: 0 } });
      await setup.runMigrations([]); // creates the ledger up front so the races below are about claims
      const n = async () => Number((await h.query('SELECT "n" FROM "counters"'))[0]?.n);
      return { h, n };
    }

    it(
      'edited, reordered and removed migrations fail before anything runs',
      async () => {
        const { h, n } = await counterSetup();
        const runtime = await h.open(counter());
        await runtime.runMigrations([bump('001'), bump('002', 10)]);
        expect(await n()).toBe(11);

        const edited = await failure(runtime.runMigrations([bump('001', 2), bump('002', 10)]));
        expect(edited).toMatchObject({ code: 'MIGRATION_CHECKSUM_MISMATCH', migrationId: '001' });
        for (const list of [[bump('002', 10), bump('001')], [bump('002', 10)], [bump('001')]]) {
          expect((await failure(runtime.runMigrations(list))).code).toBe(
            'MIGRATION_HISTORY_MISMATCH'
          );
        }
        expect(await n()).toBe(11);
        expect((await runtime.readMigrationHistory()).length).toBe(2);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'divergent runners at the same position: one wins, the other fails closed and runs nothing',
      async () => {
        const { h, n } = await counterSetup();
        const holdA = holdNextMigrationBatch();
        const holdB = holdNextMigrationBatch();
        const a = await h.open(counter(), holdA.hook);
        const b = await h.open(counter(), holdB.hook);

        const runA = a.runMigrations([bump('001_a', 1)]);
        const runB = b.runMigrations([bump('001_b', 100)]).catch((e: unknown) => e);
        await Promise.all([holdA.reached, holdB.reached]); // both planned against the empty ledger
        holdA.release();
        expect((await runA).results.map((r) => r.outcome)).toEqual(['applied']);
        holdB.release();
        expect(await runB).toMatchObject({
          code: 'MIGRATION_HISTORY_MISMATCH',
          migrationId: '001_b',
          status: 'not-applied'
        });
        expect(await n()).toBe(1);
        expect((await a.readMigrationHistory()).map((r) => r.id)).toEqual(['001_a']);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'the same migration on two runners executes exactly once; the loser reconciles',
      async () => {
        const { h, n } = await counterSetup();
        const holdA = holdNextMigrationBatch();
        const holdB = holdNextMigrationBatch();
        const a = await h.open(counter(), holdA.hook);
        const b = await h.open(counter(), holdB.hook);

        const runA = a.runMigrations([bump('001')]);
        const runB = b.runMigrations([bump('001')]);
        await Promise.all([holdA.reached, holdB.reached]);
        holdA.release();
        await runA;
        holdB.release();
        expect((await runB).results.map((r) => r.outcome)).toEqual(['reconciled']);
        expect(await n()).toBe(1);
        expect(await a.readMigrationHistory()).toEqual([
          expect.objectContaining({ id: '001', status: 'applied', attempts: 1 })
        ]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'mid-batch failure: nothing committed, recorded failed, no automatic retry, explicit retry works',
      async () => {
        const { h, n } = await counterSetup();
        const runtime = await h.open(counter());
        const risky: MigrationLike = {
          id: '001_needs_audit_table',
          description: 'Bump, write an audit row, bump again',
          destructive: false,
          statements: [
            { sql: 'UPDATE "counters" SET "n" = "n" + 1' },
            { sql: 'INSERT INTO "audit" ("note") VALUES (?)', args: ['bumped'] },
            { sql: 'UPDATE "counters" SET "n" = "n" + 1' }
          ]
        };
        expect(await failure(runtime.runMigrations([risky]))).toMatchObject({
          code: 'MIGRATION_EXECUTION_FAILED',
          status: 'failed',
          migrationId: risky.id
        });
        expect(await n()).toBe(0);
        expect(await runtime.planMigrations([risky])).toEqual([
          expect.objectContaining({ state: 'failed' })
        ]);
        expect((await failure(runtime.runMigrations([risky]))).code).toBe(
          'MIGRATION_RETRY_REQUIRED'
        );
        expect(await n()).toBe(0);

        await h.exec('CREATE TABLE "audit" ("note" TEXT)');
        const retried = await runtime.runMigrations([risky], { retryFailed: risky.id });
        expect(retried.results.map((r) => r.outcome)).toEqual(['applied']);
        expect(await n()).toBe(2);
        expect((await runtime.readMigrationHistory())[0]).toMatchObject({
          status: 'applied',
          attempts: 2
        });
      },
      TEST_TIMEOUT_MS
    );

    it(
      'a recorded failure can be replaced by a corrected definition only with replaceFailed',
      async () => {
        const { h, n } = await counterSetup();
        const runtime = await h.open(counter());
        const broken: MigrationLike = {
          id: '001_bump_typo',
          description: 'Bump (typo in the column name)',
          destructive: false,
          statements: [{ sql: 'UPDATE "counters" SET "nn" = "nn" + 1' }]
        };
        expect((await failure(runtime.runMigrations([broken]))).code).toBe(
          'MIGRATION_EXECUTION_FAILED'
        );
        const fixed = bump('001_bump');
        expect((await failure(runtime.runMigrations([fixed]))).code).toBe(
          'MIGRATION_HISTORY_MISMATCH'
        );
        const report = await runtime.runMigrations([fixed], { replaceFailed: broken.id });
        expect(report.results.map((r) => r.outcome)).toEqual(['applied']);
        expect(await n()).toBe(1);
        expect(await runtime.readMigrationHistory()).toEqual([
          expect.objectContaining({ id: '001_bump', status: 'applied', attempts: 2 })
        ]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'lost response after commit reconciles as applied; a lost request is recorded failed',
      async () => {
        const { h, n } = await counterSetup();
        let dropResponse = true;
        const lossy = await h.open(counter(), async (statements, send) => {
          await send();
          if (dropResponse && isMigrationBatch(statements)) {
            dropResponse = false;
            throw new Error('network: response lost');
          }
        });
        expect((await lossy.runMigrations([bump('001')])).results[0]?.outcome).toBe('reconciled');
        expect(await n()).toBe(1);

        let dropRequest = true;
        const unsent = await h.open(counter(), async (statements, send) => {
          if (dropRequest && isMigrationBatch(statements)) {
            dropRequest = false;
            throw new Error('network: request never arrived');
          }
          await send();
        });
        expect(await failure(unsent.runMigrations([bump('001'), bump('002')]))).toMatchObject({
          code: 'MIGRATION_EXECUTION_FAILED',
          migrationId: '002',
          status: 'failed'
        });
        expect(await n()).toBe(1);
      },
      TEST_TIMEOUT_MS
    );
  });
}
