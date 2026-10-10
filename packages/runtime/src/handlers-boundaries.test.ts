import { describe, expect, it } from 'vitest';
import { defineCollection, defineField, defineGlobal } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';
import {
  MAX_LIMIT,
  handleCreate,
  handleGetVersion,
  handleGlobalRead,
  handleGlobalUpdate,
  handleList,
  handleListVersions,
  handlePreview,
  handleRead,
  handleRestoreVersion
} from './handlers.js';

// Spec 089 — HTTP boundary evidence: malformed/over-limit input is rejected with a typed 4xx BEFORE any
// database read, upload limits hold with nothing persisted, and the version/global/preview routes
// enforce authentication, roles and required parameters.

const posts = defineCollection({
  slug: 'posts',
  versions: true,
  fields: {
    title: defineField.text({ required: true }),
    views: defineField.number(),
    live: defineField.boolean(),
    body: defineField.text()
  },
  access: {
    read: () => true,
    create: ({ user }) => user !== null,
    update: ({ user }) => user?.role === 'admin' || user?.role === 'editor'
  }
});
const media = defineCollection({
  slug: 'media',
  upload: true,
  access: { read: () => true, create: () => true },
  fields: { filename: defineField.text(), url: defineField.text() }
});
const settings = defineGlobal({
  slug: 'site_settings',
  fields: { siteName: defineField.text({ required: true }) }
});

async function build() {
  const database = new InMemoryDatabaseAdapter();
  const storage = new InMemoryStorageAdapter();
  const auth = new InMemoryAuthAdapter();
  auth.registerSession('admin', { user: { id: 'a1', role: 'admin' } });
  auth.registerSession('editor', { user: { id: 'e1', role: 'editor' } });
  auth.registerSession('viewer', { user: { id: 'v1', role: 'viewer' } });
  const runtime = new ForgeCmsRuntime({
    collections: [posts, media],
    globals: [settings],
    adapters: { database, auth, storage }
  });
  runtime.init();
  await runtime.syncSchema();

  const counts = { reads: 0 };
  for (const method of ['findMany', 'count', 'findById'] as const) {
    const original = database[method].bind(database) as (...a: unknown[]) => Promise<unknown>;
    (database as unknown as Record<string, unknown>)[method] = (...a: unknown[]) => {
      counts.reads++;
      return original(...a);
    };
  }

  const ctx = (
    method: string,
    url: string,
    params: Record<string, string> | undefined,
    opts: { token?: string; body?: BodyInit; json?: unknown } = {}
  ) => ({
    request: new Request(url, {
      method,
      headers: {
        ...(opts.json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {})
      },
      ...(opts.json !== undefined
        ? { body: JSON.stringify(opts.json) }
        : opts.body !== undefined
          ? { body: opts.body }
          : {})
    }),
    ...(params && { params }),
    env: undefined
  });

  return { database, storage, runtime, counts, ctx };
}

const errorCode = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('list query parsing rejects bad input before any database work', () => {
  const cases: Array<[string, string]> = [
    ['non-integer limit', 'limit=abc'],
    ['decimal limit', 'limit=1.5'],
    ['negative limit', 'limit=-1'],
    ['limit above the hard maximum', `limit=${MAX_LIMIT + 1}`],
    ['negative offset', 'offset=-5'],
    ['malformed sort JSON', 'sort=%5Bnot-json'],
    ['sort JSON that is not an array', `sort=${encodeURIComponent('[')}`],
    ['unknown sort field', 'sort=nope'],
    ['invalid sort order', 'sort=title&order=sideways'],
    ['unknown filter field', 'nope=1'],
    ['unknown filter operator', 'title[regex]=x'],
    ['non-numeric filter on a number field', 'views[gt]=many'],
    ['invalid depth', 'depth=2'],
    ['invalid status', 'status=archived'],
    ['malformed structured where', 'where=%7Bbroken'],
    ['structured where that is not an object', `where=${encodeURIComponent('[1]')}`]
  ];

  for (const [name, query] of cases) {
    it(`${name} → 400 INVALID_QUERY/INPUT with zero reads`, async () => {
      const { runtime, counts, ctx } = await build();
      const response = await handleList(
        ctx('GET', `http://x/api/v1/posts?${query}`, { collection: 'posts' }),
        {
          runtime
        }
      );
      expect(response.status).toBe(400);
      expect(['INVALID_QUERY', 'INVALID_INPUT']).toContain(await errorCode(response));
      expect(counts.reads).toBe(0);
    });
  }

  it('accepts a JSON-array sort, the eq/in operators and the maximum limit', async () => {
    const { runtime, ctx } = await build();
    await runtime.create({ collection: 'posts', data: { title: 'a', views: 1 } });
    await runtime.create({ collection: 'posts', data: { title: 'b', views: 2 } });
    const url = `http://x/api/v1/posts?limit=${MAX_LIMIT}&sort=${encodeURIComponent(
      JSON.stringify([{ field: 'views', order: 'desc' }])
    )}&views[in]=1,2&title[eq]=b`;
    const response = await handleList(ctx('GET', url, { collection: 'posts' }), { runtime });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ title: string }>;
      meta: { limit: number };
    };
    expect(body.data.map((d) => d.title)).toEqual(['b']);
    expect(body.meta.limit).toBe(MAX_LIMIT);
  });

  it('sorts by a plain field with an explicit order', async () => {
    const { runtime, ctx } = await build();
    await runtime.create({ collection: 'posts', data: { title: 'a', views: 1 } });
    await runtime.create({ collection: 'posts', data: { title: 'b', views: 2 } });
    const response = await handleList(
      ctx('GET', 'http://x/api/v1/posts?sort=views&order=desc', { collection: 'posts' }),
      { runtime }
    );
    const body = (await response.json()) as { data: Array<{ title: string }> };
    expect(body.data.map((d) => d.title)).toEqual(['b', 'a']);
  });
});

describe('required route parameters', () => {
  it('missing collection / id / versionId / global are 400s, an unknown collection is 404', async () => {
    const { runtime, ctx } = await build();
    expect((await handleList(ctx('GET', 'http://x/', undefined), { runtime })).status).toBe(400);
    expect(
      (await handleRead(ctx('GET', 'http://x/', { collection: 'posts' }), { runtime })).status
    ).toBe(400);
    expect(
      (await handleList(ctx('GET', 'http://x/', { collection: 'nope' }), { runtime })).status
    ).toBe(404);
    expect(
      (await handleListVersions(ctx('GET', 'http://x/', { collection: 'posts' }), { runtime }))
        .status
    ).toBe(400);
    expect(
      (
        await handleGetVersion(ctx('GET', 'http://x/', { collection: 'posts', id: '1' }), {
          runtime
        })
      ).status
    ).toBe(400);
    expect(
      (
        await handleRestoreVersion(
          ctx('POST', 'http://x/', { collection: 'posts', id: '1' }, { token: 'admin' }),
          {
            runtime
          }
        )
      ).status
    ).toBe(400);
    expect((await handleGlobalRead(ctx('GET', 'http://x/', undefined), { runtime })).status).toBe(
      400
    );
    expect(
      (await handleGlobalRead(ctx('GET', 'http://x/', { global: 'nope' }), { runtime })).status
    ).toBe(404);
  });
});

describe('upload limits are enforced before anything is stored', () => {
  const upload = (ctx: Awaited<ReturnType<typeof build>>['ctx'], file: File | null) => {
    const body = new FormData();
    if (file) body.set('file', file);
    return ctx('POST', 'http://x/api/v1/media', { collection: 'media' }, { body });
  };

  it('rejects an oversized file, a disallowed MIME type and a missing file part with nothing persisted', async () => {
    const { runtime, ctx, storage, database } = await build();
    const options = { runtime, upload: { maxFileSize: 10, mimeTypes: ['text/plain'] } };

    const big = await handleCreate(
      upload(ctx, new File(['x'.repeat(11)], 'big.txt', { type: 'text/plain' })),
      options
    );
    expect(big.status).toBe(400);
    expect(await big.text()).toContain('exceeds maximum allowed size of 10 bytes');

    const wrongType = await handleCreate(
      upload(ctx, new File(['x'], 'a.exe', { type: 'application/x-msdownload' })),
      options
    );
    expect(wrongType.status).toBe(400);
    expect(await wrongType.text()).toContain('is not allowed');

    const missing = await handleCreate(upload(ctx, null), options);
    expect(missing.status).toBe(400);

    expect(await storage.list()).toEqual([]);
    expect(await database.findMany({ collection: 'media' })).toEqual([]);
  });

  it('accepts a file exactly at the size limit with an allowed type', async () => {
    const { runtime, ctx, storage } = await build();
    const response = await handleCreate(
      upload(ctx, new File(['x'.repeat(10)], 'ok.txt', { type: 'text/plain' })),
      { runtime, upload: { maxFileSize: 10, mimeTypes: ['text/plain'] } }
    );
    expect(response.status).toBe(201);
    expect(await storage.list()).toHaveLength(1);
  });
});

describe('version routes', () => {
  async function withHistory() {
    const env = await build();
    const created = await env.runtime.create({
      collection: 'posts',
      data: { title: 'v1' },
      user: { id: 'a1', role: 'admin' } as never
    });
    await env.runtime.update({
      collection: 'posts',
      id: created.id as string,
      data: { title: 'v2' },
      user: { id: 'a1', role: 'admin' } as never
    });
    const versions = await env.runtime.listVersions({
      collection: 'posts',
      documentId: created.id as string
    });
    return { ...env, id: created.id as string, versions };
  }

  it('lists, reads and restores history for an authorised editor, with paging bounds validated', async () => {
    const { runtime, ctx, id, versions } = await withHistory();
    const list = await handleListVersions(
      ctx('GET', 'http://x/?limit=1&offset=0', { collection: 'posts', id }, { token: 'editor' }),
      { runtime }
    );
    expect(list.status).toBe(200);
    expect(((await list.json()) as { data: unknown[] }).data).toHaveLength(1);

    const badPaging = await handleListVersions(
      ctx('GET', 'http://x/?limit=-1', { collection: 'posts', id }, { token: 'editor' }),
      { runtime }
    );
    expect(badPaging.status).toBe(400);

    const oldest = versions.at(-1)!;
    const got = await handleGetVersion(
      ctx(
        'GET',
        'http://x/',
        { collection: 'posts', id, versionId: oldest.id as string },
        { token: 'editor' }
      ),
      { runtime }
    );
    expect(got.status).toBe(200);

    const restored = await handleRestoreVersion(
      ctx(
        'POST',
        'http://x/',
        { collection: 'posts', id, versionId: oldest.id as string },
        { token: 'editor' }
      ),
      { runtime }
    );
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as { data: { title: string } }).data.title).toBe('v1');
  });

  it('a caller who may not update cannot restore, and the document and history are untouched', async () => {
    const { runtime, ctx, id, versions, database } = await withHistory();
    const before = await database.findById('posts', id);
    const target = versions.at(-1)!;
    const denied = await handleRestoreVersion(
      ctx(
        'POST',
        'http://x/',
        { collection: 'posts', id, versionId: target.id as string },
        { token: 'viewer' }
      ),
      { runtime }
    );
    expect(denied.status).toBe(403);
    const anonymous = await handleRestoreVersion(
      ctx('POST', 'http://x/', { collection: 'posts', id, versionId: target.id as string }),
      { runtime }
    );
    expect(anonymous.status).toBe(401);
    expect(await database.findById('posts', id)).toEqual(before);
    expect(await runtime.listVersions({ collection: 'posts', documentId: id })).toHaveLength(
      versions.length
    );
  });

  it('an unknown version id is a 404, not a 500', async () => {
    const { runtime, ctx, id } = await withHistory();
    const response = await handleGetVersion(
      ctx(
        'GET',
        'http://x/',
        { collection: 'posts', id, versionId: 'missing' },
        { token: 'editor' }
      ),
      { runtime }
    );
    expect(response.status).toBe(404);
  });
});

describe('global routes', () => {
  it('enforce authentication and roles per route, and surface bad JSON as 400', async () => {
    const { runtime, ctx } = await build();
    const anonymous = await handleGlobalUpdate(
      ctx('PUT', 'http://x/', { global: 'site_settings' }, { json: { siteName: 'x' } }),
      { runtime, requireAuth: true }
    );
    expect(anonymous.status).toBe(401);

    const forbidden = await handleGlobalUpdate(
      ctx(
        'PUT',
        'http://x/',
        { global: 'site_settings' },
        { token: 'viewer', json: { siteName: 'x' } }
      ),
      { runtime, allowedRoles: ['admin'] }
    );
    expect(forbidden.status).toBe(403);

    const badJson = await handleGlobalUpdate(
      ctx('PUT', 'http://x/', { global: 'site_settings' }, { token: 'admin', body: '{nope' }),
      { runtime, allowedRoles: ['admin'] }
    );
    expect(badJson.status).toBe(400);

    const ok = await handleGlobalUpdate(
      ctx(
        'PUT',
        'http://x/',
        { global: 'site_settings' },
        { token: 'admin', json: { siteName: 'Forge' } }
      ),
      { runtime, allowedRoles: ['admin'] }
    );
    expect(ok.status).toBe(200);
    const read = await handleGlobalRead(ctx('GET', 'http://x/', { global: 'site_settings' }), {
      runtime
    });
    expect(((await read.json()) as { data: { siteName: string } }).data.siteName).toBe('Forge');
  });

  it('an auth adapter fault on a global route is a 500, not a 401', async () => {
    const { runtime, ctx } = await build();
    runtime.adapters.auth.requireAuth = async () => {
      throw new Error('auth backend down');
    };
    const response = await handleGlobalRead(
      ctx('GET', 'http://x/', { global: 'site_settings' }, { token: 'admin' }),
      {
        runtime,
        requireAuth: true
      }
    );
    expect(response.status).toBe(500);
  });
});

describe('preview', () => {
  it('rejects an invalid depth and tolerates an unreadable body as an empty one', async () => {
    const { runtime, ctx } = await build();
    const badDepth = await handlePreview(
      ctx(
        'POST',
        'http://x/?depth=7',
        { collection: 'posts' },
        { token: 'admin', json: { title: 't' } }
      ),
      { runtime }
    );
    expect(badDepth.status).toBe(400);

    const unreadable = await handlePreview(
      ctx('POST', 'http://x/', { collection: 'posts' }, { token: 'admin', body: '{nope' }),
      { runtime }
    );
    // An unreadable body previews as an empty one; a preview never persists anything.
    expect(unreadable.status).toBe(200);
    expect(await runtime.count({ collection: 'posts' })).toBe(0);
  });
});

describe('the HTTP layer never trusts a caller-supplied override or identity', () => {
  it('ignores overrideAccess / user in the query string and the body', async () => {
    const { runtime, ctx, database } = await build();
    const doc = await runtime.create({ collection: 'posts', data: { title: 'kept' } });

    // `create` requires an authenticated user and `update` an admin/editor (see the collection above).
    const smuggledCreate = await handleCreate(
      ctx(
        'POST',
        'http://x/api/v1/posts?overrideAccess=true&user=admin',
        { collection: 'posts' },
        {
          json: { title: 'x', overrideAccess: true, user: { id: 'a1', role: 'admin' } }
        }
      ),
      { runtime }
    );
    expect(smuggledCreate.status).toBe(401);

    // A smuggled body field is an unknown field, not a privilege: rejected, nothing stored.
    const smuggledField = await handleCreate(
      ctx(
        'POST',
        'http://x/api/v1/posts',
        { collection: 'posts' },
        { token: 'viewer', json: { title: 'x', overrideAccess: true } }
      ),
      { runtime }
    );
    expect(smuggledField.status).toBe(400);
    expect(await runtime.count({ collection: 'posts' })).toBe(1);

    // A smuggled query parameter is simply ignored: the viewer gets exactly what the rules allow.
    const queryIgnored = await handleCreate(
      ctx(
        'POST',
        'http://x/api/v1/posts?overrideAccess=true',
        { collection: 'posts' },
        { token: 'viewer', json: { title: 'y' } }
      ),
      { runtime }
    );
    expect(queryIgnored.status).toBe(201);

    const { handleUpdate } = await import('./handlers.js');
    const smuggledUpdate = await handleUpdate(
      ctx(
        'PATCH',
        'http://x/api/v1/posts/1?overrideAccess=true&user=admin',
        { collection: 'posts', id: doc.id as string },
        {
          token: 'viewer',
          json: { title: 'hijacked', overrideAccess: true, user: { id: 'a1', role: 'admin' } }
        }
      ),
      { runtime }
    );
    expect(smuggledUpdate.status).toBe(403);
    expect((await database.findById('posts', doc.id as string))?.title).toBe('kept');
  });
});
