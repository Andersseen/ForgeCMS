import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import {
  generateCreateTableSql,
  generateAddColumnSql,
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
