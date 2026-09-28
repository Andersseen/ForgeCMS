import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import type { AnyField, CollectionDefinition } from '@forge-cms/core';
import {
  SchemaDriftError,
  formatSchemaPlan,
  isSchemaDriftError,
  mergeSchemaPlans,
  parseTableBaseline,
  planTable,
  sqliteAffinity,
  tableBaseline,
  toSchemaPlan
} from './schema-plan.js';
import type { SchemaChange, SchemaProbe, StoredTable } from './schema-plan.js';
import { desiredTableSchema, generateCreateTableSql } from './schema-generator.js';

// Spec 070 — the pure planner over hand-built stored schemas. Real SQLite evidence lives in the shared
// contract (`schema-drift.libsql.test.ts`, and the D1 workers suite).

const probe = (overrides: Partial<SchemaProbe> = {}): SchemaProbe => ({
  rowCount: () => Promise.resolve(0),
  nullCount: () => Promise.resolve(0),
  valueCount: () => Promise.resolve(0),
  duplicates: () => Promise.resolve({ groups: 0, rows: 0 }),
  indexTable: () => Promise.resolve(null),
  ...overrides
});

/** The stored table Forge itself would have created for `collection`. */
function storedFor(collection: CollectionDefinition): StoredTable {
  const desired = desiredTableSchema(collection);
  return {
    name: desired.name,
    columns: desired.columns.map((c) => ({
      name: c.name,
      type: c.type,
      primaryKey: c.role === 'primary-key' ? 1 : 0
    })),
    indexes: [
      {
        name: `sqlite_autoindex_${desired.name}_1`,
        columns: ['id'],
        unique: true,
        origin: 'pk',
        partial: false
      },
      ...desired.indexes.map((i) => ({
        name: i.name,
        columns: i.fields,
        unique: i.unique,
        origin: 'c',
        partial: false
      }))
    ]
  };
}

async function planBetween(
  v1: CollectionDefinition,
  v2: CollectionDefinition,
  p: SchemaProbe = probe()
): Promise<SchemaChange[]> {
  const result = await planTable(
    { collection: v2, stored: storedFor(v1), baseline: tableBaseline(v1), recordsBaseline: true },
    p
  );
  return result.changes;
}

const withField = (field: AnyField) =>
  defineCollection({ slug: 'posts', fields: { value: field } });

describe('desired model (spec 070 §1)', () => {
  it('lists the Forge system columns, then fields, and keeps generateCreateTableSql byte-identical', () => {
    const media = defineCollection({
      slug: 'media',
      drafts: true,
      upload: true,
      fields: { alt: defineField.text(), size: defineField.number(), ok: defineField.boolean() }
    });
    expect(desiredTableSchema(media).columns.map((c) => `${c.name}:${c.type}:${c.role}`)).toEqual([
      'id:TEXT:primary-key',
      'created_at:TEXT:system',
      'updated_at:TEXT:system',
      '_status:TEXT:system',
      '_storageKey:TEXT:system',
      'alt:TEXT:field',
      'size:REAL:field',
      'ok:INTEGER:field'
    ]);
    expect(generateCreateTableSql(media)).toBe(
      'CREATE TABLE IF NOT EXISTS "media" ("id" TEXT PRIMARY KEY, "created_at" TEXT, "updated_at" TEXT, ' +
        '"_status" TEXT, "_storageKey" TEXT, "alt" TEXT, "size" REAL, "ok" INTEGER)'
    );
  });
});

describe('sqliteAffinity', () => {
  it.each([
    ['TEXT', 'TEXT'],
    ['varchar(255)', 'TEXT'],
    ['CLOB', 'TEXT'],
    ['INTEGER', 'INTEGER'],
    ['TINYINT', 'INTEGER'],
    ['REAL', 'REAL'],
    ['DOUBLE PRECISION', 'REAL'],
    ['FLOAT', 'REAL'],
    ['BLOB', 'BLOB'],
    ['', 'BLOB'],
    ['NUMERIC', 'NUMERIC'],
    ['DECIMAL(10,5)', 'NUMERIC']
  ])('%s → %s', (declared, affinity) => {
    expect(sqliteAffinity(declared)).toBe(affinity);
  });
});

describe('planTable — field-kind compatibility matrix (same storage type)', () => {
  const kinds: [string, AnyField][] = [
    ['text', defineField.text()],
    ['textarea', defineField.textarea()],
    ['email', defineField.email()],
    ['slug', defineField.slug()],
    ['select', defineField.select({ options: ['a'] })],
    ['richtext', defineField.richtext()],
    ['json', defineField.json()],
    ['date', defineField.date()],
    ['relation', defineField.relation({ collection: 'tags' })],
    ['group', defineField.group({ fields: { a: defineField.text() } })],
    ['blocks', defineField.blocks({ blocks: [{ slug: 'b', fields: {} }] })]
  ];
  const informational = new Set([
    'text>textarea',
    'textarea>text',
    'email>text',
    'email>textarea',
    'slug>text',
    'slug>textarea',
    'select>text',
    'select>textarea'
  ]);

  for (const [from, fromField] of kinds) {
    for (const [to, toField] of kinds) {
      if (from === to) continue;
      const expected = informational.has(`${from}>${to}`) ? 'informational' : 'manual-migration';
      it(`${from} → ${to}: ${expected}`, async () => {
        const changes = await planBetween(withField(fromField), withField(toField));
        const kind = changes.find((c) => c.kind === 'field-kind-changed');
        expect(kind?.classification).toBe(expected);
      });
    }
  }

  it('upload target and relation target changes are manual', async () => {
    const changes = await planBetween(
      withField(defineField.relation({ collection: 'tags' })),
      withField(defineField.relation({ collection: 'categories' }))
    );
    expect(changes).toEqual([
      expect.objectContaining({
        kind: 'field-target-changed',
        classification: 'manual-migration',
        stored: 'tags',
        desired: 'categories'
      })
    ]);
  });

  it('a kind change across storage types is reported once, as a type change naming both kinds', async () => {
    const changes = await planBetween(
      withField(defineField.text()),
      withField(defineField.boolean())
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: 'column-type-changed',
      stored: 'TEXT',
      desired: 'INTEGER'
    });
    expect(changes[0]?.reason).toContain('from text to boolean');
  });
});

describe('planTable — baseline', () => {
  it('first adoption records a baseline and compares no semantic option', async () => {
    const v1 = withField(defineField.text());
    const { changes } = await planTable(
      {
        collection: withField(defineField.text({ localized: true, required: true })),
        stored: storedFor(v1),
        baseline: null,
        recordsBaseline: true
      },
      probe({ nullCount: () => Promise.reject(new Error('must not probe without a baseline')) })
    );
    expect(changes.map((c) => [c.kind, c.classification])).toEqual([
      ['baseline-recorded', 'informational']
    ]);
  });

  it('an unreadable or newer baseline is unsupported', async () => {
    expect(parseTableBaseline('{"format":2,"fields":{}}')).toBe('unknown');
    expect(parseTableBaseline('not json')).toBe('unknown');
    const v1 = withField(defineField.text());
    const { changes } = await planTable(
      { collection: v1, stored: storedFor(v1), baseline: 'unknown', recordsBaseline: true },
      probe()
    );
    expect(changes).toEqual([
      expect.objectContaining({ kind: 'baseline-unreadable', classification: 'unsupported' })
    ]);
  });

  it('a non-JSON default gets one stable marker, so it never reads as changed between starts', () => {
    const at = (d: unknown) =>
      tableBaseline(
        defineCollection({ slug: 'p', fields: { when: defineField.date({ defaultValue: d }) } })
      );
    expect(at(new Date(1)).fields.when?.default).toBe('dynamic');
    expect(at(new Date(2))).toEqual(at(new Date(1)));
    expect(at(() => 1).fields.when?.default).toBe('dynamic');
    expect(at({ a: 1 }).fields.when?.default).toBe('{"a":1}');
  });

  it('serializes deterministically regardless of field declaration order', () => {
    const a = defineCollection({
      slug: 'p',
      fields: { b: defineField.text(), a: defineField.text() }
    });
    const b = defineCollection({
      slug: 'p',
      fields: { a: defineField.text(), b: defineField.text() }
    });
    expect(JSON.stringify(tableBaseline(a))).toBe(JSON.stringify(tableBaseline(b)));
  });
});

describe('plans, errors and formatting', () => {
  const change = (
    table: string,
    kind: SchemaChange['kind'],
    classification: SchemaChange['classification']
  ): SchemaChange => ({
    table,
    kind,
    target: { type: 'column', name: 'x' },
    classification,
    reason: 'because'
  });

  it('orders by table, kind and target; merge de-duplicates identical changes', () => {
    const plan = mergeSchemaPlans([
      toSchemaPlan([
        change('b', 'column-added', 'safe-additive'),
        change('a', 'index-added', 'safe-additive')
      ]),
      toSchemaPlan([
        change('a', 'column-removed', 'manual-migration'),
        change('b', 'column-added', 'safe-additive')
      ])
    ]);
    expect(plan.changes.map((c) => `${c.table}/${c.kind}`)).toEqual([
      'a/column-removed',
      'a/index-added',
      'b/column-added'
    ]);
    expect(plan.blocking).toBe(true);
  });

  it('formats deterministically, blocking first, with no values', () => {
    const plan = toSchemaPlan([
      {
        ...change('posts', 'column-type-changed', 'manual-migration'),
        stored: 'TEXT',
        desired: 'REAL'
      },
      change('posts', 'column-added', 'safe-additive'),
      change('posts', 'field-default-changed', 'informational')
    ]);
    expect(formatSchemaPlan(plan)).toBe(
      [
        'Schema plan: 1 blocking, 1 safe additive, 1 informational.',
        '',
        'Blocking (manual migration or unsupported):',
        '  posts.x  column-type-changed  [manual-migration]',
        '    stored: TEXT; desired: REAL',
        '    because',
        '',
        'Safe additive (applied by syncSchema() only when nothing blocks):',
        '  posts.x  column-added  [safe-additive]',
        '    because',
        '',
        'Informational:',
        '  posts.x  field-default-changed  [informational]',
        '    because'
      ].join('\n')
    );
    expect(formatSchemaPlan(toSchemaPlan([]))).toBe('Schema plan: no changes.');
  });

  it('SchemaDriftError carries the plan and a stable code', () => {
    const plan = toSchemaPlan([change('posts', 'column-removed', 'manual-migration')]);
    const error = new SchemaDriftError(plan);
    expect(error.code).toBe('SCHEMA_DRIFT');
    expect(error.plan).toBe(plan);
    expect(error.message).toMatch(
      /^Schema drift detected: 1 blocking change; syncSchema\(\) applied nothing\./
    );
    expect(isSchemaDriftError(error)).toBe(true);
    expect(isSchemaDriftError(new Error('SQLITE_ERROR'))).toBe(false);
  });
});
