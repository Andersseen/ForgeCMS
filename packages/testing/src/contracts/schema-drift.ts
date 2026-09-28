import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import type { CollectionDefinition } from '@forge-cms/core';

// Schema drift contract (spec 070, roadmap 0.7 M01). One scenario body for every persisted SQLite
// backend (on-disk libSQL, local D1), so their classifications cannot diverge. Duck-typed on purpose —
// like every other contract here it must not import `@forge-cms/db`.

type Row = Record<string, unknown>;

/** The subset of a plan the suite reads. */
export interface SchemaDriftPlanLike {
  changes: readonly {
    table: string;
    kind: string;
    target: { type: string; name: string };
    classification: string;
    reason: string;
    stored?: string;
    desired?: string;
    affectedRows?: number;
    duplicateGroups?: number;
  }[];
  blocking: boolean;
}

/** The subset of a `DatabaseAdapter` under test. */
export interface SchemaDriftAdapter {
  syncSchema(collections: CollectionDefinition[]): Promise<void>;
  planSchema(collections: CollectionDefinition[]): Promise<SchemaDriftPlanLike>;
  create(collection: string, data: Row): Promise<Row>;
  findById(collection: string, id: string): Promise<Row | null>;
}

export interface SchemaDriftHarness {
  /** A **new** adapter instance over the same persisted database — a process restart. */
  open(): Promise<SchemaDriftAdapter>;
  /** Raw read against the same database. */
  query(sql: string): Promise<Row[]>;
  /** Raw statement against the same database (legacy layouts the adapter would never create). */
  exec(sql: string): Promise<void>;
}

const TEST_TIMEOUT_MS = 30_000;
const t = defineField.text;

let counter = 0;
/** A table prefix no other test has used, so one shared database needs no cleanup. */
function prefix(): string {
  return `sd${Date.now().toString(36)}${(counter++).toString(36)}`;
}

function collection(
  slug: string,
  options: Omit<CollectionDefinition, 'slug'>
): CollectionDefinition {
  return defineCollection({ slug, ...options } as CollectionDefinition);
}

function driftError(err: unknown): SchemaDriftPlanLike {
  expect(err).toBeInstanceOf(Error);
  expect((err as { code?: unknown }).code).toBe('SCHEMA_DRIFT');
  expect((err as Error).name).toBe('SchemaDriftError');
  return (err as { plan: SchemaDriftPlanLike }).plan;
}

function only(plan: SchemaDriftPlanLike, table: string) {
  return plan.changes.filter((c) => c.table === table);
}

export function runSchemaDriftContractTests(
  label: string,
  createHarness: () => Promise<SchemaDriftHarness>
): void {
  describe(`${label} — schema drift contract (spec 070)`, () => {
    /** Columns, indexes, every row and the baseline of `tables`: everything a refused sync must not touch. */
    async function state(h: SchemaDriftHarness, tables: string[]): Promise<unknown> {
      const out: Record<string, unknown> = {};
      for (const table of tables) {
        out[`${table}:columns`] = await h.query(
          `SELECT "name", "type", "pk" FROM pragma_table_info('${table}') ORDER BY "cid"`
        );
        out[`${table}:indexes`] = await h.query(
          `SELECT "name", "unique", "origin" FROM pragma_index_list('${table}') ORDER BY "name"`
        );
        const exists = (out[`${table}:columns`] as Row[]).length > 0;
        out[`${table}:rows`] = exists
          ? await h.query(`SELECT * FROM "${table}" ORDER BY "id"`)
          : [];
      }
      const hasBaseline =
        (await h.query(`SELECT "name" FROM pragma_table_info('_forge_schema')`)).length > 0;
      out.baseline = hasBaseline
        ? await h.query(
            `SELECT "id", "snapshot" FROM "_forge_schema" WHERE "id" IN (${tables.map((x) => `'${x}'`).join(', ')}) ORDER BY "id"`
          )
        : [];
      return out;
    }

    /** Syncs v1, seeds rows, then plans + attempts v2 through a fresh adapter; returns the refusal's plan. */
    async function refuses(
      h: SchemaDriftHarness,
      v1: CollectionDefinition,
      v2: CollectionDefinition,
      seed: Row[]
    ): Promise<SchemaDriftPlanLike> {
      const first = await h.open();
      await first.syncSchema([v1]);
      for (const row of seed) await first.create(v1.slug, row);

      const second = await h.open();
      const planned = await second.planSchema([v2]);
      expect(planned.blocking).toBe(true);
      const before = await state(h, [v1.slug]);
      const refusal = await second.syncSchema([v2]).catch((e: unknown) => e);
      const plan = driftError(refusal);
      expect(plan).toEqual(planned);
      // Nothing was executed: columns, indexes, rows and baseline are byte-identical.
      expect(await state(h, [v1.slug])).toEqual(before);
      return plan;
    }

    it(
      'fresh database: every table is safe-additive; after sync the plan is empty',
      async () => {
        const h = await createHarness();
        const p = prefix();
        const posts = collection(`${p}_posts`, {
          drafts: true,
          fields: { title: t({ required: true }), slug: defineField.slug({ unique: true }) },
          indexes: [{ fields: ['title', 'slug'] }]
        });
        const adapter = await h.open();
        const plan = await adapter.planSchema([posts]);
        expect(only(plan, posts.slug)).toEqual([
          expect.objectContaining({ kind: 'table-added', classification: 'safe-additive' })
        ]);
        expect(plan.blocking).toBe(false);
        await adapter.syncSchema([posts]);
        expect((await (await h.open()).planSchema([posts])).changes).toEqual([]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'new optional field (with a default): applied, existing rows keep their data and read the new field as empty',
      async () => {
        const h = await createHarness();
        const slug = `${prefix()}_posts`;
        const v1 = collection(slug, { fields: { title: t() } });
        const v2 = collection(slug, {
          fields: { title: t(), summary: t({ defaultValue: 'none' }) }
        });
        const first = await h.open();
        await first.syncSchema([v1]);
        const row = await first.create(slug, { title: 'kept' });

        const second = await h.open();
        const plan = await second.planSchema([v2]);
        expect(only(plan, slug)).toEqual([
          expect.objectContaining({
            kind: 'column-added',
            target: { type: 'column', name: 'summary' },
            classification: 'safe-additive'
          })
        ]);
        await second.syncSchema([v2]);
        expect(await second.findById(slug, row.id as string)).toMatchObject({
          title: 'kept',
          summary: null
        });
        expect((await (await h.open()).planSchema([v2])).changes).toEqual([]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'removed field: manual migration, the column and its values stay',
      async () => {
        const h = await createHarness();
        const slug = `${prefix()}_posts`;
        const plan = await refuses(
          h,
          collection(slug, { fields: { title: t(), legacy: t() } }),
          collection(slug, { fields: { title: t() } }),
          [{ title: 'a', legacy: 'kept value' }]
        );
        expect(only(plan, slug)).toEqual([
          expect.objectContaining({
            kind: 'column-removed',
            target: { type: 'column', name: 'legacy' },
            classification: 'manual-migration',
            stored: 'TEXT'
          })
        ]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'rename is never inferred: one removal plus one addition, reported separately',
      async () => {
        const h = await createHarness();
        const slug = `${prefix()}_posts`;
        const plan = await refuses(
          h,
          collection(slug, { fields: { title: t(), headline: t() } }),
          collection(slug, { fields: { title: t(), heading: t() } }),
          [{ title: 'a', headline: 'h' }]
        );
        expect(only(plan, slug).map((c) => [c.kind, c.target.name, c.classification])).toEqual([
          ['column-added', 'heading', 'safe-additive'],
          ['column-removed', 'headline', 'manual-migration']
        ]);
        expect(JSON.stringify(plan)).not.toMatch(/renam(e|ed) (to|from)/i);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'storage type change (text -> number): manual migration, TEXT vs REAL',
      async () => {
        const h = await createHarness();
        const slug = `${prefix()}_posts`;
        const plan = await refuses(
          h,
          collection(slug, { fields: { title: t(), views: t() } }),
          collection(slug, { fields: { title: t(), views: defineField.number() } }),
          [{ title: 'a', views: 'many' }]
        );
        expect(only(plan, slug)).toEqual([
          expect.objectContaining({
            kind: 'column-type-changed',
            classification: 'manual-migration',
            stored: 'TEXT',
            desired: 'REAL'
          })
        ]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'drafts enabled: safe on an empty table, manual when rows would lose their status',
      async () => {
        const h = await createHarness();
        const p = prefix();
        const empty = `${p}_empty`;
        const adapter = await h.open();
        await adapter.syncSchema([collection(empty, { fields: { title: t() } })]);
        const withDrafts = collection(empty, { drafts: true, fields: { title: t() } });
        const plan = await (await h.open()).planSchema([withDrafts]);
        expect(only(plan, empty)).toEqual([
          expect.objectContaining({
            kind: 'system-column-added',
            target: { type: 'system-column', name: '_status' },
            classification: 'safe-additive'
          })
        ]);
        const next = await h.open();
        await next.syncSchema([withDrafts]);
        expect(await next.create(empty, { title: 'a', _status: 'draft' })).toMatchObject({
          _status: 'draft'
        });

        const full = `${p}_full`;
        const refused = await refuses(
          h,
          collection(full, { fields: { title: t() } }),
          collection(full, { drafts: true, fields: { title: t() } }),
          [{ title: 'a' }, { title: 'b' }]
        );
        expect(only(refused, full)).toEqual([
          expect.objectContaining({
            kind: 'system-column-added',
            target: { type: 'system-column', name: '_status' },
            classification: 'manual-migration',
            affectedRows: 2
          })
        ]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'upload enabled: safe on an empty table, manual when rows are not file records',
      async () => {
        const h = await createHarness();
        const p = prefix();
        const empty = `${p}_empty`;
        await (await h.open()).syncSchema([collection(empty, { fields: { title: t() } })]);
        const asUpload = collection(empty, { upload: true, fields: { title: t() } });
        const plan = await (await h.open()).planSchema([asUpload]);
        expect(only(plan, empty)).toEqual([
          expect.objectContaining({
            kind: 'system-column-added',
            target: { type: 'system-column', name: '_storageKey' },
            classification: 'safe-additive'
          })
        ]);

        const full = `${p}_full`;
        const refused = await refuses(
          h,
          collection(full, { fields: { title: t() } }),
          collection(full, { upload: true, fields: { title: t() } }),
          [{ title: 'a' }]
        );
        expect(only(refused, full)).toEqual([
          expect.objectContaining({
            kind: 'system-column-added',
            target: { type: 'system-column', name: '_storageKey' },
            classification: 'manual-migration',
            affectedRows: 1
          })
        ]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'drafts disabled: the stale _status column blocks and counts the drafts that would go public',
      async () => {
        const h = await createHarness();
        const slug = `${prefix()}_posts`;
        const plan = await refuses(
          h,
          collection(slug, { drafts: true, fields: { title: t() } }),
          collection(slug, { fields: { title: t() } }),
          [
            { title: 'a', _status: 'draft' },
            { title: 'b', _status: 'published' }
          ]
        );
        expect(only(plan, slug)).toEqual([
          expect.objectContaining({
            kind: 'system-column-removed',
            target: { type: 'system-column', name: '_status' },
            classification: 'manual-migration',
            affectedRows: 1
          })
        ]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'non-unique -> unique on the same index name: manual, even though the data is unique',
      async () => {
        const h = await createHarness();
        const slug = `${prefix()}_posts`;
        const plan = await refuses(
          h,
          collection(slug, { fields: { title: t(), slug: defineField.slug({ index: true }) } }),
          collection(slug, { fields: { title: t(), slug: defineField.slug({ unique: true }) } }),
          [{ title: 'a', slug: 'x' }]
        );
        expect(only(plan, slug)).toEqual([
          expect.objectContaining({
            kind: 'index-changed',
            target: { type: 'index', name: `idx_${slug}_slug` },
            classification: 'manual-migration',
            stored: 'non-unique (slug)',
            desired: 'unique (slug)'
          })
        ]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'unique -> non-unique: manual, and the stored UNIQUE index keeps enforcing until a reviewed migration',
      async () => {
        const h = await createHarness();
        const slug = `${prefix()}_posts`;
        const plan = await refuses(
          h,
          collection(slug, { fields: { title: t(), slug: defineField.slug({ unique: true }) } }),
          collection(slug, { fields: { title: t(), slug: defineField.slug({ index: true }) } }),
          [{ title: 'a', slug: 'a' }]
        );
        expect(only(plan, slug)).toEqual([
          expect.objectContaining({
            kind: 'index-changed',
            classification: 'manual-migration',
            stored: 'unique (slug)',
            desired: 'non-unique (slug)'
          })
        ]);
        const indexes = await h.query(
          `SELECT "name", "unique" FROM pragma_index_list('${slug}') WHERE "origin" = 'c'`
        );
        expect(indexes.map((r) => [r.name, Number(r.unique)])).toEqual([[`idx_${slug}_slug`, 1]]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'removed non-unique index: informational, sync succeeds, the index is not dropped',
      async () => {
        const h = await createHarness();
        const slug = `${prefix()}_posts`;
        const first = await h.open();
        await first.syncSchema([collection(slug, { fields: { title: t({ index: true }) } })]);
        const v2 = collection(slug, { fields: { title: t() } });
        const second = await h.open();
        const plan = await second.planSchema([v2]);
        expect(only(plan, slug)).toEqual([
          expect.objectContaining({
            kind: 'index-removed',
            target: { type: 'index', name: `idx_${slug}_title` },
            classification: 'informational'
          })
        ]);
        await second.syncSchema([v2]);
        expect(
          await h.query(`SELECT "name" FROM pragma_index_list('${slug}') WHERE "origin" = 'c'`)
        ).toEqual([{ name: `idx_${slug}_title` }]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'compound unique (a, b) -> (a, c): the stale unique index blocks; nothing is created or dropped',
      async () => {
        const h = await createHarness();
        const slug = `${prefix()}_posts`;
        const fields = { a: t(), b: t(), c: t() };
        const plan = await refuses(
          h,
          collection(slug, { fields, indexes: [{ fields: ['a', 'b'], unique: true }] }),
          collection(slug, { fields, indexes: [{ fields: ['a', 'c'], unique: true }] }),
          [{ a: '1', b: '1', c: '1' }]
        );
        expect(only(plan, slug).map((c) => [c.kind, c.target.name, c.classification])).toEqual([
          ['index-added', `idx_${slug}_a_c`, 'safe-additive'],
          ['index-removed', `idx_${slug}_a_b`, 'manual-migration']
        ]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'new unique index over legacy duplicates: manual with counts, no row deleted or rewritten',
      async () => {
        const h = await createHarness();
        const slug = `${prefix()}_posts`;
        const plan = await refuses(
          h,
          collection(slug, { fields: { title: t(), slug: defineField.slug() } }),
          collection(slug, { fields: { title: t(), slug: defineField.slug({ unique: true }) } }),
          [
            { title: 'a', slug: 'same' },
            { title: 'b', slug: 'same' },
            { title: 'c', slug: 'other' },
            { title: 'd', slug: 'other' },
            { title: 'e', slug: 'other' },
            { title: 'f', slug: 'unique' }
          ]
        );
        const [change] = only(plan, slug);
        expect(change).toMatchObject({
          kind: 'index-added',
          classification: 'manual-migration',
          duplicateGroups: 2,
          affectedRows: 5
        });
        expect(change?.reason).not.toMatch(/same|other/);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'NULL parity: rows with a NULL indexed value never count as duplicates, and SQLite accepts the index',
      async () => {
        const h = await createHarness();
        const slug = `${prefix()}_posts`;
        const first = await h.open();
        await first.syncSchema([
          collection(slug, { fields: { tenant: t(), slug: t(), sku: t() } })
        ]);
        for (const row of [
          { tenant: 't', slug: null, sku: null },
          { tenant: 't', slug: null, sku: null },
          { tenant: null, slug: 'x', sku: null }
        ]) {
          await first.create(slug, row);
        }
        const v2 = collection(slug, {
          fields: { tenant: t(), slug: t(), sku: t({ unique: true }) },
          indexes: [{ fields: ['tenant', 'slug'], unique: true }]
        });
        const second = await h.open();
        const plan = await second.planSchema([v2]);
        expect(only(plan, slug).map((c) => [c.kind, c.classification])).toEqual([
          ['index-added', 'safe-additive'],
          ['index-added', 'safe-additive']
        ]);
        await second.syncSchema([v2]);
        expect(
          (
            await h.query(`SELECT "unique" FROM pragma_index_list('${slug}') WHERE "origin" = 'c'`)
          ).map((r) => Number(r.unique))
        ).toEqual([1, 1]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'new unique index over unique data: safe-additive, created in the same transaction',
      async () => {
        const h = await createHarness();
        const slug = `${prefix()}_posts`;
        const first = await h.open();
        await first.syncSchema([collection(slug, { fields: { code: t() } })]);
        await first.create(slug, { code: 'a' });
        await first.create(slug, { code: 'b' });
        const v2 = collection(slug, { fields: { code: t({ unique: true }) } });
        const second = await h.open();
        await second.syncSchema([v2]);
        await expect(second.create(slug, { code: 'a' })).rejects.toThrow();
      },
      TEST_TIMEOUT_MS
    );

    it(
      'localized toggle and relation cardinality: TEXT -> TEXT is still a manual migration',
      async () => {
        const h = await createHarness();
        const p = prefix();
        const localized = `${p}_loc`;
        const locPlan = await refuses(
          h,
          collection(localized, { fields: { title: t() } }),
          collection(localized, {
            locales: ['en', 'es'],
            fields: { title: t({ localized: true }) }
          }),
          [{ title: 'Hello' }]
        );
        expect(only(locPlan, localized)).toEqual([
          expect.objectContaining({
            kind: 'field-localized-changed',
            classification: 'manual-migration',
            stored: 'not localized',
            desired: 'localized'
          })
        ]);

        const back = `${p}_unloc`;
        const backPlan = await refuses(
          h,
          collection(back, { locales: ['en'], fields: { title: t({ localized: true }) } }),
          collection(back, { fields: { title: t() } }),
          [{ title: { en: 'Hello' } }]
        );
        expect(only(backPlan, back)[0]).toMatchObject({
          kind: 'field-localized-changed',
          desired: 'not localized'
        });

        for (const [from, to] of [
          [false, true],
          [true, false]
        ] as const) {
          const slug = `${p}_rel${String(from)}`;
          const plan = await refuses(
            h,
            collection(slug, {
              fields: { tag: defineField.relation({ collection: 'tags', many: from }) }
            }),
            collection(slug, {
              fields: { tag: defineField.relation({ collection: 'tags', many: to }) }
            }),
            [{ tag: from ? ['t1', 't2'] : 't1' }]
          );
          expect(only(plan, slug)).toEqual([
            expect.objectContaining({
              kind: 'field-cardinality-changed',
              classification: 'manual-migration',
              stored: from ? 'many' : 'single',
              desired: to ? 'many' : 'single'
            })
          ]);
        }
      },
      TEST_TIMEOUT_MS
    );

    it(
      'kind changes within TEXT: text -> textarea informational; text -> email and json -> blocks manual',
      async () => {
        const h = await createHarness();
        const p = prefix();
        const loose = `${p}_loose`;
        await (await h.open()).syncSchema([collection(loose, { fields: { body: t() } })]);
        const asTextarea = collection(loose, { fields: { body: defineField.textarea() } });
        const plan = await (await h.open()).planSchema([asTextarea]);
        expect(only(plan, loose)).toEqual([
          expect.objectContaining({ kind: 'field-kind-changed', classification: 'informational' })
        ]);
        await (await h.open()).syncSchema([asTextarea]);
        expect((await (await h.open()).planSchema([asTextarea])).changes).toEqual([]);

        const email = `${p}_email`;
        const emailPlan = await refuses(
          h,
          collection(email, { fields: { contact: t() } }),
          collection(email, { fields: { contact: defineField.email() } }),
          [{ contact: 'not an email' }]
        );
        expect(only(emailPlan, email)[0]).toMatchObject({
          kind: 'field-kind-changed',
          classification: 'manual-migration',
          stored: 'text',
          desired: 'email'
        });

        const blocks = `${p}_blocks`;
        const blocksPlan = await refuses(
          h,
          collection(blocks, { fields: { layout: defineField.json() } }),
          collection(blocks, {
            fields: {
              layout: defineField.blocks({
                blocks: [{ slug: 'hero', fields: { heading: t() } }]
              })
            }
          }),
          [{ layout: { any: 'json' } }]
        );
        expect(only(blocksPlan, blocks)[0]).toMatchObject({
          kind: 'field-kind-changed',
          classification: 'manual-migration'
        });
      },
      TEST_TIMEOUT_MS
    );

    it(
      'new required field: manual when rows exist, safe on an empty table',
      async () => {
        const h = await createHarness();
        const p = prefix();
        const full = `${p}_full`;
        const plan = await refuses(
          h,
          collection(full, { fields: { title: t() } }),
          collection(full, {
            fields: { title: t(), summary: t({ required: true, defaultValue: 'x' }) }
          }),
          [{ title: 'a' }, { title: 'b' }]
        );
        expect(only(plan, full)).toEqual([
          expect.objectContaining({
            kind: 'column-added',
            classification: 'manual-migration',
            affectedRows: 2
          })
        ]);

        const empty = `${p}_empty`;
        await (await h.open()).syncSchema([collection(empty, { fields: { title: t() } })]);
        const v2 = collection(empty, { fields: { title: t(), summary: t({ required: true }) } });
        const emptyPlan = await (await h.open()).planSchema([v2]);
        expect(only(emptyPlan, empty)[0]).toMatchObject({
          kind: 'column-added',
          classification: 'safe-additive'
        });
      },
      TEST_TIMEOUT_MS
    );

    it(
      'optional -> required: blocks while rows lack a value; passes once they are backfilled',
      async () => {
        const h = await createHarness();
        const slug = `${prefix()}_posts`;
        const plan = await refuses(
          h,
          collection(slug, { fields: { title: t(), summary: t() } }),
          collection(slug, { fields: { title: t(), summary: t({ required: true }) } }),
          [{ title: 'a' }, { title: 'b', summary: 's' }]
        );
        expect(only(plan, slug)).toEqual([
          expect.objectContaining({
            kind: 'field-required-added',
            classification: 'manual-migration',
            affectedRows: 1
          })
        ]);

        await h.exec(`UPDATE "${slug}" SET "summary" = 'backfilled' WHERE "summary" IS NULL`);
        const v2 = collection(slug, { fields: { title: t(), summary: t({ required: true }) } });
        const adapter = await h.open();
        expect(only(await adapter.planSchema([v2]), slug)).toEqual([
          expect.objectContaining({ kind: 'field-required-added', classification: 'informational' })
        ]);
        await adapter.syncSchema([v2]);
        expect((await (await h.open()).planSchema([v2])).changes).toEqual([]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'default changed: informational, applied, and no existing row is rewritten',
      async () => {
        const h = await createHarness();
        const slug = `${prefix()}_posts`;
        const first = await h.open();
        await first.syncSchema([
          collection(slug, { fields: { theme: t({ defaultValue: 'light' }) } })
        ]);
        const row = await first.create(slug, { theme: 'light' });
        const v2 = collection(slug, { fields: { theme: t({ defaultValue: 'dark' }) } });
        const second = await h.open();
        expect(only(await second.planSchema([v2]), slug)).toEqual([
          expect.objectContaining({
            kind: 'field-default-changed',
            classification: 'informational',
            stored: '"light"',
            desired: '"dark"'
          })
        ]);
        await second.syncSchema([v2]);
        expect(await second.findById(slug, row.id as string)).toMatchObject({ theme: 'light' });
      },
      TEST_TIMEOUT_MS
    );

    it(
      'a refused plan leaves JSON, composite, localized and many-relation values byte-identical',
      async () => {
        const h = await createHarness();
        const slug = `${prefix()}_rich`;
        const fields = {
          meta: defineField.json(),
          seo: defineField.group({ fields: { title: t() } }),
          links: defineField.array({ fields: { url: t() } }),
          layout: defineField.blocks({ blocks: [{ slug: 'hero', fields: { heading: t() } }] }),
          body: defineField.richtext(),
          tagline: t({ localized: true }),
          tags: defineField.relation({ collection: 'tags', many: true }),
          views: t()
        };
        await refuses(
          h,
          collection(slug, { locales: ['en', 'es'], fields }),
          collection(slug, {
            locales: ['en', 'es'],
            fields: { ...fields, views: defineField.number() }
          }),
          [
            {
              meta: { nested: { ok: true }, list: [1, 2] },
              seo: { title: 'T' },
              links: [{ url: 'https://a' }, { url: 'https://b' }],
              layout: [{ blockType: 'hero', heading: 'Hi' }],
              body: [{ type: 'paragraph', children: [{ text: 'x' }] }],
              tagline: { en: 'Hello', es: 'Hola' },
              tags: ['t1', 't2'],
              views: '12'
            }
          ]
        );
      },
      TEST_TIMEOUT_MS
    );

    it(
      'plan before mutation: a safe change on one table and a blocker on another run no DDL at all',
      async () => {
        const h = await createHarness();
        const p = prefix();
        const a = `${p}_a`;
        const b = `${p}_b`;
        const first = await h.open();
        await first.syncSchema([
          collection(a, { fields: { title: t() } }),
          collection(b, { fields: { views: t() } })
        ]);
        await first.create(b, { views: '3' });

        const v2 = [
          collection(a, { fields: { title: t(), summary: t() } }),
          collection(b, { fields: { views: defineField.number() } })
        ];
        const before = await state(h, [a, b]);
        const second = await h.open();
        const plan = driftError(await second.syncSchema(v2).catch((e: unknown) => e));
        expect(plan.changes.map((c) => [c.table, c.kind, c.classification])).toEqual([
          [a, 'column-added', 'safe-additive'],
          [b, 'column-type-changed', 'manual-migration']
        ]);
        expect(await state(h, [a, b])).toEqual(before);
        expect(
          (await h.query(`SELECT "name" FROM pragma_table_info('${a}')`)).map((r) => r.name)
        ).not.toContain('summary');
      },
      TEST_TIMEOUT_MS
    );

    it(
      'determinism: planning unchanged state twice, from two adapter instances, gives deep-equal plans',
      async () => {
        const h = await createHarness();
        const p = prefix();
        const slug = `${p}_posts`;
        const first = await h.open();
        await first.syncSchema([
          collection(slug, {
            fields: {
              title: t(),
              legacy: t(),
              views: t(),
              slug: t({ index: true }),
              a: t(),
              b: t()
            },
            indexes: [{ fields: ['a', 'b'], unique: true }]
          })
        ]);
        await first.create(slug, { title: 'x', slug: 's' });
        const v2 = [
          collection(slug, {
            drafts: true,
            fields: {
              title: t({ localized: true }),
              views: defineField.number(),
              slug: t({ unique: true }),
              a: t(),
              b: t(),
              extra: t()
            },
            indexes: [{ fields: ['b', 'a'], unique: true }]
          }),
          collection(`${p}_new`, { fields: { title: t() } })
        ];
        const one = await (await h.open()).planSchema(v2);
        const two = await (await h.open()).planSchema(v2);
        expect(two).toEqual(one);
        expect(one.blocking).toBe(true);
        const keys = one.changes.map((c) => `${c.table}/${c.kind}/${c.target.name}`);
        // Tables in name order; every change listed once.
        const tables = one.changes.map((c) => c.table);
        expect(tables).toEqual([...tables].sort());
        expect(new Set(keys).size).toBe(keys.length);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'first adoption: a pre-070 table has no baseline — recorded, informational, never guessed',
      async () => {
        const h = await createHarness();
        const slug = `${prefix()}_legacy`;
        await h.exec(
          `CREATE TABLE "${slug}" ("id" TEXT PRIMARY KEY, "created_at" TEXT, "updated_at" TEXT, "title" TEXT)`
        );
        await h.exec(`INSERT INTO "${slug}" ("id", "title") VALUES ('r1', 'old')`);
        const def = collection(slug, { fields: { title: t({ localized: true }) } });
        const adapter = await h.open();
        const plan = await adapter.planSchema([def]);
        expect(only(plan, slug)).toEqual([
          expect.objectContaining({ kind: 'baseline-recorded', classification: 'informational' })
        ]);
        await adapter.syncSchema([def]);
        const [baseline] = await h.query(
          `SELECT "snapshot" FROM "_forge_schema" WHERE "id" = '${slug}'`
        );
        expect(JSON.parse(String(baseline?.snapshot))).toMatchObject({
          format: 1,
          fields: { title: { kind: 'text', localized: true } }
        });
      },
      TEST_TIMEOUT_MS
    );

    it(
      'index names are database-wide: a generated name colliding with another table is unsupported',
      async () => {
        const h = await createHarness();
        const p = prefix();
        // `idx_<p>_blog_posts_slug` from table `<p>_blog` + field `posts_slug`, and from `<p>_blog_posts` + `slug`.
        const blog = collection(`${p}_blog`, { fields: { posts_slug: t({ unique: true }) } });
        const blogPosts = collection(`${p}_blog_posts`, { fields: { slug: t({ unique: true }) } });
        const name = `idx_${p}_blog_posts_slug`;

        const together = await (await h.open()).planSchema([blog, blogPosts]);
        expect(together.blocking).toBe(true);
        expect(together.changes).toContainEqual(
          expect.objectContaining({
            table: blogPosts.slug,
            target: { type: 'index', name },
            classification: 'unsupported'
          })
        );

        const adapter = await h.open();
        await adapter.syncSchema([blog]);
        const later = await (await h.open()).planSchema([blogPosts]);
        expect(later.changes).toContainEqual(
          expect.objectContaining({
            table: blogPosts.slug,
            kind: 'index-added',
            target: { type: 'index', name },
            classification: 'unsupported'
          })
        );
        await expect((await h.open()).syncSchema([blogPosts])).rejects.toMatchObject({
          code: 'SCHEMA_DRIFT'
        });
      },
      TEST_TIMEOUT_MS
    );

    it(
      'unsupported layouts: no TEXT id primary key; an undeclared column UNIQUE constraint',
      async () => {
        const h = await createHarness();
        const p = prefix();
        const noPk = `${p}_nopk`;
        await h.exec(`CREATE TABLE "${noPk}" ("id" INTEGER, "created_at" TEXT, "updated_at" TEXT)`);
        const plan = await (await h.open()).planSchema([collection(noPk, { fields: {} })]);
        expect(only(plan, noPk)).toContainEqual(
          expect.objectContaining({ kind: 'table-structure', classification: 'unsupported' })
        );

        const constrained = `${p}_uniq`;
        await h.exec(
          `CREATE TABLE "${constrained}" ("id" TEXT PRIMARY KEY, "created_at" TEXT, "updated_at" TEXT, "code" TEXT UNIQUE)`
        );
        const uPlan = await (
          await h.open()
        ).planSchema([collection(constrained, { fields: { code: t() } })]);
        expect(only(uPlan, constrained)).toContainEqual(
          expect.objectContaining({ kind: 'index-removed', classification: 'unsupported' })
        );
      },
      TEST_TIMEOUT_MS
    );

    it(
      'type spelling is compared by SQLite affinity: VARCHAR/DOUBLE/TINYINT/BOOLEAN are not drift',
      async () => {
        const h = await createHarness();
        const slug = `${prefix()}_aff`;
        await h.exec(
          `CREATE TABLE "${slug}" ("id" VARCHAR(36) PRIMARY KEY, "created_at" TEXT, "updated_at" CLOB, ` +
            `"title" VARCHAR(255), "views" DOUBLE PRECISION, "flag" TINYINT, "active" BOOLEAN)`
        );
        const plan = await (
          await h.open()
        ).planSchema([
          collection(slug, {
            fields: {
              title: t(),
              views: defineField.number(),
              flag: defineField.boolean(),
              active: defineField.boolean()
            }
          })
        ]);
        expect(only(plan, slug).map((c) => c.kind)).toEqual(['baseline-recorded']);
      },
      TEST_TIMEOUT_MS
    );
  });
}
