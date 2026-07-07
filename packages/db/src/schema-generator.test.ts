import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { generateCreateTableSql } from './schema-generator.js';

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
