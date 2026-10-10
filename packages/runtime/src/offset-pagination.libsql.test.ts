import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { LibSqlDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';
import { handleList } from './handlers.js';

// Spec 089 regression: `GET /api/v1/<collection>?offset=N` (an offset with no limit) was a 500 on SQL
// backends because SQLite rejects OFFSET without LIMIT. Found by measuring D1 branch coverage.

const notes = defineCollection({
  slug: 'notes',
  access: { read: () => true },
  fields: { n: defineField.number() }
});

describe('offset without limit over a real SQL backend', () => {
  it('serves the remaining rows with correct pagination metadata', async () => {
    const database = new LibSqlDatabaseAdapter('file::memory:');
    database.init();
    const runtime = new ForgeCmsRuntime({
      collections: [notes],
      adapters: { database, auth: new InMemoryAuthAdapter(), storage: new InMemoryStorageAdapter() }
    });
    runtime.init();
    await runtime.syncSchema();
    for (const n of [1, 2, 3, 4]) await runtime.create({ collection: 'notes', data: { n } });

    const response = await handleList(
      {
        request: new Request('http://x/api/v1/notes?offset=1&sort=n'),
        params: { collection: 'notes' },
        env: undefined
      },
      { runtime }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ n: number }>;
      meta: { totalDocs: number; offset: number };
    };
    expect(body.data.map((d) => d.n)).toEqual([2, 3, 4]);
    expect(body.meta).toMatchObject({ totalDocs: 4, offset: 1 });
  });
});
