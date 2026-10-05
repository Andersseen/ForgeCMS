import { describe, expect, it } from 'vitest';
import { createClient, type InValue } from '@libsql/client';
import { defineCollection, defineField } from '@forge-cms/core';
import type { CollectionDefinition } from '@forge-cms/core';
import { planSqliteSchema, syncSqliteSchema, type SqliteSchemaExecutor } from './sqlite-schema.js';

// Every schema read is a network round trip on D1, and `syncSchema()` runs on each cold start: the
// number of reads must not grow with the number of tables or indexes (a ~10-collection site used to
// issue ~100, which took >10 s from a colo far from the database).

function countingExecutor(): { executor: SqliteSchemaExecutor; reads: () => number } {
  const client = createClient({ url: ':memory:' });
  let reads = 0;
  return {
    reads: () => reads,
    executor: {
      async query(sql, args = []) {
        reads++;
        const result = await client.execute({ sql, args: args as InValue[] });
        return result.rows.map((row) => ({ ...row }));
      },
      async batch(statements) {
        await client.batch(
          statements.map((s) => ({ sql: s.sql, args: (s.args ?? []) as InValue[] })),
          'write'
        );
      }
    }
  };
}

function collections(count: number): CollectionDefinition[] {
  return Array.from({ length: count }, (_, i) =>
    defineCollection({
      slug: `things_${i}`,
      fields: {
        title: defineField.text({ required: true }),
        slug: defineField.slug({ index: true }),
        email: defineField.email({ unique: true })
      },
      indexes: [{ fields: ['title', 'slug'], unique: true }]
    })
  );
}

async function steadyStateReads(count: number): Promise<number> {
  const { executor, reads } = countingExecutor();
  const defs = collections(count);
  await syncSqliteSchema(executor, defs);
  const before = reads();
  const plan = await planSqliteSchema(executor, defs);
  expect(plan.changes).toEqual([]);
  return reads() - before;
}

describe('SQLite schema introspection round trips', () => {
  it('plans an up-to-date schema with a constant number of reads, whatever the table count', async () => {
    const small = await steadyStateReads(1);
    const large = await steadyStateReads(12);
    expect(large).toBe(small);
    expect(large).toBeLessThanOrEqual(4);
  });

  it('still sees every stored column and index (a re-sync of an unchanged schema is a no-op)', async () => {
    const { executor } = countingExecutor();
    const defs = collections(3);
    await syncSqliteSchema(executor, defs);
    const plan = await syncSqliteSchema(executor, defs);
    expect(plan.changes).toEqual([]);
    expect(plan.blocking).toBe(false);
  });
});
