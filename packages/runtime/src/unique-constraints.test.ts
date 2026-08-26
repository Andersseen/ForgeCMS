import { describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';
import { UniqueConstraintError } from './errors.js';
import { handleCreate, handleUpdate } from './handlers.js';

/**
 * Proves spec 046's end-to-end contract: a compound `unique: true` index conflict — the motivating
 * Glossa case, `(project, locale, namespace)` — surfaces as the same `UniqueConstraintError` whether
 * you call the Local API directly or go through the HTTP handlers, and as `409` over HTTP.
 */
const catalogs = defineCollection({
  slug: 'catalogs',
  fields: {
    project: defineField.text({ required: true }),
    locale: defineField.text({ required: true }),
    namespace: defineField.text()
  },
  indexes: [{ fields: ['project', 'locale', 'namespace'], unique: true }]
});

async function buildRuntime() {
  const runtime = new ForgeCmsRuntime({
    collections: [catalogs],
    adapters: {
      database: new InMemoryDatabaseAdapter(),
      auth: new InMemoryAuthAdapter(),
      storage: new InMemoryStorageAdapter()
    }
  });
  runtime.init();
  await runtime.syncSchema();
  return runtime;
}

describe('Local API — compound unique constraints', () => {
  it('rejects a duplicate (project, locale, namespace) combination on create', async () => {
    const runtime = await buildRuntime();
    await runtime.create({
      collection: 'catalogs',
      data: { project: 'p1', locale: 'en', namespace: '' }
    });

    const err = await runtime
      .create({ collection: 'catalogs', data: { project: 'p1', locale: 'en', namespace: '' } })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UniqueConstraintError);
    expect((err as UniqueConstraintError).status).toBe(409);
    expect((err as UniqueConstraintError).code).toBe('UNIQUE_CONSTRAINT');
    expect((err as UniqueConstraintError).collection).toBe('catalogs');
    expect((err as UniqueConstraintError).fields).toEqual(['project', 'locale', 'namespace']);
  });

  it('allows a different locale for the same project', async () => {
    const runtime = await buildRuntime();
    await runtime.create({
      collection: 'catalogs',
      data: { project: 'p1', locale: 'en', namespace: '' }
    });

    const second = await runtime.create({
      collection: 'catalogs',
      data: { project: 'p1', locale: 'es', namespace: '' }
    });
    expect(second.locale).toBe('es');
  });

  it('allows updating a record without changing its unique combination', async () => {
    const runtime = await buildRuntime();
    const created = await runtime.create({
      collection: 'catalogs',
      data: { project: 'p1', locale: 'en', namespace: '' }
    });

    const updated = await runtime.update({
      collection: 'catalogs',
      id: created.id as string,
      data: { namespace: '' }
    });
    expect(updated.project).toBe('p1');
  });

  it("rejects updating a record into another record's unique combination", async () => {
    const runtime = await buildRuntime();
    await runtime.create({
      collection: 'catalogs',
      data: { project: 'p1', locale: 'en', namespace: '' }
    });
    const other = await runtime.create({
      collection: 'catalogs',
      data: { project: 'p1', locale: 'es', namespace: '' }
    });

    const err = await runtime
      .update({ collection: 'catalogs', id: other.id as string, data: { locale: 'en' } })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UniqueConstraintError);
  });
});

describe('HTTP handlers — compound unique constraints', () => {
  function jsonRequest(
    method: string,
    url: string,
    body: unknown,
    params: Record<string, string> = { collection: 'catalogs' }
  ): Parameters<typeof handleCreate>[0] {
    return {
      request: new Request(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }),
      env: {},
      params
    };
  }

  it('returns 409 UNIQUE_CONSTRAINT on a create conflict', async () => {
    const runtime = await buildRuntime();
    const options = { runtime };

    await handleCreate(
      jsonRequest('POST', 'http://x/api/v1/catalogs', {
        project: 'p1',
        locale: 'en',
        namespace: ''
      }),
      options
    );

    const conflict = await handleCreate(
      jsonRequest('POST', 'http://x/api/v1/catalogs', {
        project: 'p1',
        locale: 'en',
        namespace: ''
      }),
      options
    );

    expect(conflict.status).toBe(409);
    const body = (await conflict.json()) as {
      error: { code: string; details?: { collection: string; fields: string[] } };
    };
    expect(body.error.code).toBe('UNIQUE_CONSTRAINT');
    expect(body.error.details).toEqual({
      collection: 'catalogs',
      fields: ['project', 'locale', 'namespace']
    });
  });

  it('returns 409 on an update that conflicts with another document', async () => {
    const runtime = await buildRuntime();
    const options = { runtime };

    await handleCreate(
      jsonRequest('POST', 'http://x/api/v1/catalogs', {
        project: 'p1',
        locale: 'en',
        namespace: ''
      }),
      options
    );
    const createdOther = await handleCreate(
      jsonRequest('POST', 'http://x/api/v1/catalogs', {
        project: 'p1',
        locale: 'es',
        namespace: ''
      }),
      options
    );
    const { data: other } = (await createdOther.json()) as { data: { id: string } };

    const conflict = await handleUpdate(
      jsonRequest(
        'PUT',
        `http://x/api/v1/catalogs/${other.id}`,
        { locale: 'en' },
        {
          collection: 'catalogs',
          id: other.id
        }
      ),
      options
    );

    expect(conflict.status).toBe(409);
  });
});
