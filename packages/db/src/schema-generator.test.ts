import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import {
  generateCreateTableSql,
  generateAddColumnSql,
  generateIndexSql,
  resolveCollectionIndexes,
  fieldKindToSqlType,
  toDbValue,
  fromDbValue
} from './schema-generator.js';

describe('generateCreateTableSql', () => {
  const posts = defineCollection({
    slug: 'posts',
    fields: {
      title: defineField.text({ required: true }),
      views: defineField.number(),
      published: defineField.boolean()
    }
  });

  it('produces a single-line statement', () => {
    // Cloudflare D1's real exec() splits its input on '\n' to detect multiple statements, so any
    // embedded newline breaks CREATE TABLE into invalid fragments (verified against a real local D1
    // binding — mocked-adapter tests alone did not catch this).
    const sql = generateCreateTableSql(posts);
    expect(sql).not.toMatch(/\n/);
  });

  it('includes the id/created_at/updated_at columns plus one per field', () => {
    const sql = generateCreateTableSql(posts);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "posts"');
    expect(sql).toContain('"id" TEXT PRIMARY KEY');
    expect(sql).toContain('"created_at" TEXT');
    expect(sql).toContain('"updated_at" TEXT');
    expect(sql).toContain('"title" TEXT');
    expect(sql).toContain('"views" REAL');
    expect(sql).toContain('"published" INTEGER');
  });

  it('handles a collection with no extra fields', () => {
    const empty = defineCollection({ slug: 'empty', fields: {} });
    const sql = generateCreateTableSql(empty);
    expect(sql).not.toMatch(/\n/);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "empty"');
    expect(sql).toContain('"updated_at" TEXT)');
  });
});

describe('generateAddColumnSql', () => {
  const posts = defineCollection({
    slug: 'posts',
    fields: {
      title: defineField.text({ required: true }),
      views: defineField.number()
    }
  });

  it('generates one ALTER TABLE per missing column', () => {
    const statements = generateAddColumnSql(posts, ['title']);
    expect(statements).toEqual(['ALTER TABLE "posts" ADD COLUMN "views" REAL']);
  });

  it('returns an empty array when every field already has a column', () => {
    const statements = generateAddColumnSql(posts, ['title', 'views']);
    expect(statements).toEqual([]);
  });

  it('returns one statement per field for a table with none of its columns yet', () => {
    const statements = generateAddColumnSql(posts, []);
    expect(statements).toHaveLength(2);
    expect(statements).toEqual(
      expect.arrayContaining([
        'ALTER TABLE "posts" ADD COLUMN "title" TEXT',
        'ALTER TABLE "posts" ADD COLUMN "views" REAL'
      ])
    );
  });

  it('ignores system columns (id/created_at/updated_at) since they are never in collection.fields', () => {
    const statements = generateAddColumnSql(posts, ['id', 'created_at', 'updated_at']);
    expect(statements).toHaveLength(2);
  });
});

describe('richtext field storage', () => {
  const field = defineField.richtext();

  it('maps to the TEXT sql type', () => {
    expect(fieldKindToSqlType(field)).toBe('TEXT');
  });

  it('round-trips a document through toDbValue/fromDbValue', () => {
    const doc = [
      { type: 'heading', level: 2, children: [{ type: 'text', text: 'Title', bold: true }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'Body copy.' }] }
    ];

    const stored = toDbValue(doc, 'richtext');
    expect(typeof stored).toBe('string');

    const restored = fromDbValue(stored, 'richtext');
    expect(restored).toEqual(doc);
  });

  it('passes null/undefined through unchanged', () => {
    expect(toDbValue(null, 'richtext')).toBeNull();
    expect(toDbValue(undefined, 'richtext')).toBeNull();
    expect(fromDbValue(null, 'richtext')).toBeNull();
  });
});

describe('upload field storage', () => {
  it('maps to the TEXT sql type', () => {
    const field = defineField.upload({ collection: 'media' });
    expect(fieldKindToSqlType(field)).toBe('TEXT');
  });

  it('passes a bare id string through toDbValue/fromDbValue unchanged', () => {
    expect(toDbValue('media-1', 'upload')).toBe('media-1');
    expect(fromDbValue('media-1', 'upload')).toBe('media-1');
  });
});

describe('drafts (_status column)', () => {
  it('adds a "_status" column when drafts is true', () => {
    const posts = defineCollection({
      slug: 'posts',
      fields: { title: defineField.text() },
      drafts: true
    });
    const sql = generateCreateTableSql(posts);
    expect(sql).toContain('"_status" TEXT');
  });

  it('omits "_status" when drafts is not set', () => {
    const posts = defineCollection({ slug: 'posts', fields: { title: defineField.text() } });
    const sql = generateCreateTableSql(posts);
    expect(sql).not.toContain('_status');
  });
});

describe('composite fields (spec 022)', () => {
  const landing = defineCollection({
    slug: 'landing',
    fields: {
      title: defineField.text(),
      seo: defineField.group({ fields: { metaTitle: defineField.text() } }),
      steps: defineField.array({ fields: { label: defineField.text() } }),
      sections: defineField.blocks({
        blocks: [{ slug: 'hero', fields: { heading: defineField.text() } }]
      })
    }
  });

  it('stores every composite kind in a TEXT column', () => {
    const sql = generateCreateTableSql(landing);
    expect(sql).toContain('"seo" TEXT');
    expect(sql).toContain('"steps" TEXT');
    expect(sql).toContain('"sections" TEXT');
  });

  it('serialises composite values to JSON on the way in', () => {
    expect(toDbValue({ metaTitle: 'x' }, 'group')).toBe('{"metaTitle":"x"}');
    expect(toDbValue([{ label: 'a' }], 'array')).toBe('[{"label":"a"}]');
    expect(toDbValue([{ blockType: 'hero' }], 'blocks')).toBe('[{"blockType":"hero"}]');
  });

  it('round-trips composite values through the database representation', () => {
    const group = { metaTitle: 'Home', nested: { deep: true } };
    expect(fromDbValue(toDbValue(group, 'group'), 'group')).toEqual(group);

    const rows = [{ label: 'a' }, { label: 'b' }];
    expect(fromDbValue(toDbValue(rows, 'array'), 'array')).toEqual(rows);

    const blocks = [{ blockType: 'hero', heading: 'Hi' }];
    expect(fromDbValue(toDbValue(blocks, 'blocks'), 'blocks')).toEqual(blocks);
  });

  it('leaves an unparseable stored value alone rather than throwing', () => {
    expect(fromDbValue('not json', 'group')).toBe('not json');
  });

  it('adds a composite column additively when it is new to the definition', () => {
    const statements = generateAddColumnSql(landing, ['id', 'created_at', 'updated_at', 'title']);
    expect(statements).toContain('ALTER TABLE "landing" ADD COLUMN "seo" TEXT');
    expect(statements).toContain('ALTER TABLE "landing" ADD COLUMN "sections" TEXT');
  });
});

describe('index generation (spec 046)', () => {
  it('generates no indexes for a collection with none declared', () => {
    const posts = defineCollection({ slug: 'posts', fields: { title: defineField.text() } });
    expect(resolveCollectionIndexes(posts)).toEqual([]);
    expect(generateIndexSql(posts)).toEqual([]);
  });

  it('keeps generating the same single-field index name/SQL as before (no regression)', () => {
    const posts = defineCollection({
      slug: 'posts',
      fields: {
        slug: defineField.slug({ index: true }),
        email: defineField.email({ unique: true })
      }
    });

    expect(resolveCollectionIndexes(posts)).toEqual([
      { name: 'idx_posts_slug', fields: ['slug'], unique: false },
      { name: 'idx_posts_email', fields: ['email'], unique: true }
    ]);

    const sql = generateIndexSql(posts);
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "idx_posts_slug" ON "posts" ("slug")');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_posts_email" ON "posts" ("email")'
    );
  });

  it('generates a deterministic compound index name from field order', () => {
    const catalogs = defineCollection({
      slug: 'catalogs',
      fields: {
        project: defineField.relation({ collection: 'projects', required: true }),
        locale: defineField.text({ required: true }),
        namespace: defineField.text()
      },
      indexes: [{ fields: ['project', 'locale', 'namespace'], unique: true }]
    });

    expect(resolveCollectionIndexes(catalogs)).toEqual([
      {
        name: 'idx_catalogs_project_locale_namespace',
        fields: ['project', 'locale', 'namespace'],
        unique: true
      }
    ]);
    expect(generateIndexSql(catalogs)).toEqual([
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_catalogs_project_locale_namespace" ON "catalogs" ("project", "locale", "namespace")'
    ]);
  });

  it('generates a non-unique compound index without the UNIQUE keyword', () => {
    const events = defineCollection({
      slug: 'events',
      fields: { tenant: defineField.text({ required: true }), kind: defineField.text() },
      indexes: [{ fields: ['tenant', 'kind'] }]
    });

    expect(generateIndexSql(events)).toEqual([
      'CREATE INDEX IF NOT EXISTS "idx_events_tenant_kind" ON "events" ("tenant", "kind")'
    ]);
  });

  it('names a compound index differently when field order differs', () => {
    const a = defineCollection({
      slug: 'x',
      fields: { a: defineField.text(), b: defineField.text() },
      indexes: [{ fields: ['a', 'b'] }]
    });
    const b = defineCollection({
      slug: 'x',
      fields: { a: defineField.text(), b: defineField.text() },
      indexes: [{ fields: ['b', 'a'] }]
    });

    expect(resolveCollectionIndexes(a)[0]?.name).toBe('idx_x_a_b');
    expect(resolveCollectionIndexes(b)[0]?.name).toBe('idx_x_b_a');
  });

  it('combines field-level and collection-level indexes in one list', () => {
    const catalogs = defineCollection({
      slug: 'catalogs',
      fields: {
        slug: defineField.slug({ unique: true }),
        project: defineField.text({ required: true }),
        locale: defineField.text({ required: true })
      },
      indexes: [{ fields: ['project', 'locale'], unique: true }]
    });

    expect(resolveCollectionIndexes(catalogs)).toEqual([
      { name: 'idx_catalogs_slug', fields: ['slug'], unique: true },
      { name: 'idx_catalogs_project_locale', fields: ['project', 'locale'], unique: true }
    ]);
  });

  it('throws for an invalid index definition (referencing db-level identifier validation)', () => {
    expect(() =>
      generateIndexSql({
        slug: 'catalogs',
        fields: { project: defineField.text() },
        indexes: [{ fields: ['doesNotExist'] }]
      })
    ).toThrow('references unknown field "doesNotExist"');
  });
});
