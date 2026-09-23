import { describe, expect, it, vi } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import type { CollectionDefinition } from '@forge-cms/core';
import { InMemoryDatabaseAdapter, LibSqlDatabaseAdapter } from '@forge-cms/db';
import type { DatabaseAdapter } from '@forge-cms/db';
import {
  ApiKeyAuthAdapter,
  CompositeAuthAdapter,
  InMemoryAuthAdapter,
  UserMutationError,
  UsersCollectionAuthAdapter,
  defineUsersCollection,
  withAuthFields
} from '@forge-cms/auth';
import type { AuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import type { ApiContext } from '@forge-cms/api';
import { ForgeCmsRuntime } from './runtime.js';
import { AuthManagedCollectionError } from './errors.js';
import { handleCreate, handleDelete, handleList, handleRead, handleUpdate } from './handlers.js';
import { handleCascadeDelete, handleSetNullOnDelete } from './relation-integrity.js';

/**
 * Spec 061 — a collection managed by an auth adapter cannot be mutated through generic collection
 * CRUD. Access control (who may write), field access (which fields) and the auth adapter's lifecycle
 * invariants (last admin, first-admin bootstrap, password hashing, email normalisation, session
 * versioning) are three separate concerns; the third must hold even for trusted Local API calls whose
 * `overrideAccess` defaults to `true`.
 */

const MANAGED = { code: 'AUTH_MANAGED_COLLECTION', status: 403 } as const;

type Backend = 'in-memory' | 'libsql';
const BACKENDS: Backend[] = ['in-memory', 'libsql'];

function createDb(backend: Backend): DatabaseAdapter {
  return backend === 'libsql'
    ? new LibSqlDatabaseAdapter('file::memory:').init()
    : new InMemoryDatabaseAdapter();
}

interface SetupOptions {
  backend?: Backend;
  /** The collection the auth adapter manages. Defaults to `users`. */
  slug?: string;
  /** Replaces the default `defineUsersCollection({ slug })`. */
  managedCollection?: CollectionDefinition;
  extraCollections?: CollectionDefinition[];
  /** Wraps the users-collection adapter (e.g. in a `CompositeAuthAdapter`). */
  wrapAuth?: (users: UsersCollectionAuthAdapter, db: DatabaseAdapter) => AuthAdapter;
}

async function setup(options: SetupOptions = {}) {
  const db = createDb(options.backend ?? 'in-memory');
  const slug = options.slug ?? 'users';
  const auth = new UsersCollectionAuthAdapter({ devMode: true, collection: slug });
  const runtime = new ForgeCmsRuntime({
    collections: [
      options.managedCollection ?? defineUsersCollection({ slug }),
      ...(options.extraCollections ?? [])
    ],
    adapters: {
      database: db,
      auth: options.wrapAuth ? options.wrapAuth(auth, db) : auth,
      storage: new InMemoryStorageAdapter()
    },
    env: { userDatabase: db, apiKeyDatabase: db }
  });
  runtime.init();
  await runtime.syncSchema();
  return { runtime, auth, db, slug };
}

async function createUser(
  auth: UsersCollectionAuthAdapter,
  email: string,
  role?: 'admin' | 'editor' | 'viewer'
) {
  const result = await auth.createUser({ email, password: 'password123', ...(role && { role }) });
  if (!result.ok) throw new Error(`createUser(${email}) failed: ${result.reason}`);
  return result.user;
}

/** A valid state with exactly one admin, as the task brief asks. */
async function oneAdmin(options: SetupOptions = {}) {
  const ctx = await setup(options);
  const admin = await createUser(ctx.auth, 'admin@example.com');
  expect(admin.role).toBe('admin');
  expect(await ctx.db.count(ctx.slug, { role: 'admin' })).toBe(1);
  return { ...ctx, admin };
}

function contextFor(request: Request, params?: Record<string, string>): ApiContext<unknown> {
  return { request, env: {}, ...(params !== undefined && { params }) };
}

async function bearerFor(auth: UsersCollectionAuthAdapter, email: string): Promise<string> {
  const login = await auth.login(email, 'password123');
  if (!login.ok) throw new Error('login failed');
  return login.token;
}

async function json<T = { error?: { code?: string; message?: string; details?: unknown } }>(
  response: Response
): Promise<T> {
  return (await response.json()) as T;
}

describe.each(BACKENDS)('auth-managed collection — Local API (%s)', (backend) => {
  it('REPRODUCTION: a trusted delete cannot remove the only administrator', async () => {
    const { runtime, auth, db, admin } = await oneAdmin({ backend });

    // The canonical surface refuses …
    await expect(auth.deleteUser(admin.id)).rejects.toBeInstanceOf(UserMutationError);
    // … and the generic surface must agree, with the default trusted `overrideAccess: true`.
    await expect(runtime.delete({ collection: 'users', id: admin.id })).rejects.toMatchObject(
      MANAGED
    );

    expect(await db.count('users')).toBe(1);
    expect(await db.findById('users', admin.id)).not.toBeNull();
  });

  it('REPRODUCTION: a trusted update cannot demote the only administrator', async () => {
    const { runtime, auth, db, admin } = await oneAdmin({ backend });

    await expect(auth.updateUser(admin.id, { role: 'viewer' })).rejects.toBeInstanceOf(
      UserMutationError
    );
    await expect(
      runtime.update({ collection: 'users', id: admin.id, data: { role: 'viewer' } })
    ).rejects.toMatchObject(MANAGED);

    expect((await db.findById('users', admin.id))?.role).toBe('admin');
    expect(await db.count('users', { role: 'admin' })).toBe(1);
  });

  it('a trusted delete/demotion is refused even when a second admin exists (not a last-admin check)', async () => {
    const { runtime, auth, db } = await oneAdmin({ backend });
    const second = await createUser(auth, 'second@example.com', 'admin');

    await expect(runtime.delete({ collection: 'users', id: second.id })).rejects.toMatchObject(
      MANAGED
    );
    await expect(
      runtime.update({ collection: 'users', id: second.id, data: { role: 'editor' } })
    ).rejects.toMatchObject(MANAGED);
    expect(await db.count('users', { role: 'admin' })).toBe(2);

    // The canonical path still allows exactly these changes.
    await expect(auth.updateUser(second.id, { role: 'editor' })).resolves.toMatchObject({
      role: 'editor'
    });
    await expect(auth.deleteUser(second.id)).resolves.toBeUndefined();
  });

  it('REPRODUCTION: generic create cannot make a user row outside the auth lifecycle', async () => {
    const { runtime, db } = await setup({ backend });

    // Fresh install: no user and no bootstrap claim yet.
    expect(await db.count('users')).toBe(0);
    expect(await db.count('_forge_bootstrap')).toBe(0);

    await expect(
      runtime.create({
        collection: 'users',
        data: { email: 'Rogue@Example.COM', role: 'admin', passwordHash: 'not-a-real-hash' }
      })
    ).rejects.toMatchObject(MANAGED);
    // Even a perfectly ordinary payload is refused: the restriction is broad, not field-classified.
    await expect(
      runtime.create({ collection: 'users', data: { email: 'plain@example.com', role: 'viewer' } })
    ).rejects.toMatchObject(MANAGED);

    expect(await db.count('users')).toBe(0);
    expect(await db.count('_forge_bootstrap')).toBe(0);
  });

  it('a rejected generic create leaves first-admin bootstrap intact', async () => {
    const { runtime, auth, db } = await setup({ backend });

    await expect(
      runtime.create({ collection: 'users', data: { email: 'rogue@example.com', role: 'viewer' } })
    ).rejects.toMatchObject(MANAGED);

    const first = await auth.signup({ email: 'first@example.com', password: 'password123' });
    if (!first.ok) throw new Error('signup failed');
    expect(first.user.role).toBe('admin');
    expect(await db.count('_forge_bootstrap')).toBe(1);
    expect(await db.count('users')).toBe(1);
  });

  const AUTH_OWNED_MUTATIONS: Array<[string, Record<string, unknown>]> = [
    ['role', { role: 'viewer' }],
    ['email (not normalised)', { email: '  Someone@Else.COM ' }],
    ['passwordHash', { passwordHash: 'attacker-chosen-hash' }],
    ['_sessionVersion', { _sessionVersion: 99 }],
    ['name (an ordinary field)', { name: 'Renamed' }]
  ];

  it.each(AUTH_OWNED_MUTATIONS)(
    'generic update of %s is refused and leaves the row untouched',
    async (_label, data) => {
      const { runtime, db, admin } = await oneAdmin({ backend });
      const before = await db.findById('users', admin.id);

      await expect(
        runtime.update({ collection: 'users', id: admin.id, data })
      ).rejects.toMatchObject(MANAGED);

      expect(await db.findById('users', admin.id)).toEqual(before);
    }
  );

  // Trusted, admin, plain user, anonymous — the outcome is the same for every caller, because the
  // boundary is a property of the collection's configuration, not of the caller's authority.
  const CALLERS: Array<[string, (admin: { id: string }, viewer: { id: string }) => object]> = [
    ['trusted (overrideAccess defaults to true)', () => ({})],
    ['trusted, explicit overrideAccess: true', () => ({ overrideAccess: true })],
    [
      'admin with overrideAccess: false (collection access would ALLOW it)',
      (admin) => ({ overrideAccess: false, user: { id: admin.id, role: 'admin' } })
    ],
    [
      'viewer with overrideAccess: false',
      (_admin, viewer) => ({ overrideAccess: false, user: { id: viewer.id, role: 'viewer' } })
    ],
    ['anonymous with overrideAccess: false', () => ({ overrideAccess: false, user: null })]
  ];

  it.each(CALLERS)('create/update/delete are refused for: %s', async (_label, callerFor) => {
    const { runtime, auth, db, admin } = await oneAdmin({ backend });
    const viewer = await createUser(auth, 'viewer@example.com', 'viewer');
    const caller = callerFor(admin, viewer);
    const before = await db.findMany({ collection: 'users' });

    await expect(
      runtime.create({ collection: 'users', data: { email: 'x@example.com' }, ...caller })
    ).rejects.toMatchObject(MANAGED);
    await expect(
      runtime.update({ collection: 'users', id: viewer.id, data: { name: 'x' }, ...caller })
    ).rejects.toMatchObject(MANAGED);
    await expect(
      runtime.delete({ collection: 'users', id: viewer.id, ...caller })
    ).rejects.toMatchObject(MANAGED);

    expect(await db.findMany({ collection: 'users' })).toEqual(before);
  });

  it('the refusal is the same for a document that does not exist (no existence oracle)', async () => {
    const { runtime } = await oneAdmin({ backend });
    await expect(
      runtime.update({ collection: 'users', id: 'does-not-exist', data: { name: 'x' } })
    ).rejects.toMatchObject(MANAGED);
    await expect(
      runtime.delete({ collection: 'users', id: 'does-not-exist' })
    ).rejects.toMatchObject(MANAGED);
  });

  it('the error is a typed ForgeError with a message that names the collection and the way out', async () => {
    const { runtime, admin } = await oneAdmin({ backend });
    const error = await runtime
      .delete({ collection: 'users', id: admin.id })
      .then(() => null)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AuthManagedCollectionError);
    const managed = error as AuthManagedCollectionError;
    expect(managed.status).toBe(403);
    expect(managed.code).toBe('AUTH_MANAGED_COLLECTION');
    expect(managed.collection).toBe('users');
    expect(managed.message).toBe(
      "Collection 'users' is managed by the configured auth adapter and cannot be mutated through " +
        "generic collection CRUD. Use the auth adapter's user-management operations instead."
    );
  });

  it('the dedicated surface keeps working: create, update, password change, delete, signup', async () => {
    const { auth, db, admin } = await oneAdmin({ backend });

    const editor = await createUser(auth, 'editor@example.com', 'editor');
    await expect(
      auth.updateUser(editor.id, { name: 'Ed', role: 'viewer', email: 'ED@example.com' })
    ).resolves.toMatchObject({ name: 'Ed', role: 'viewer', email: 'ed@example.com' });

    const oldToken = await bearerFor(auth, 'ed@example.com');
    await auth.updateUser(editor.id, { password: 'a-brand-new-password' });
    // Password change: new password works, sessions issued before it stop working.
    expect((await auth.login('ed@example.com', 'a-brand-new-password')).ok).toBe(true);
    expect(await auth.validateSession(oldToken)).toBeNull();

    await expect(auth.deleteUser(editor.id)).resolves.toBeUndefined();
    expect(await db.findById('users', editor.id)).toBeNull();

    const signup = await auth.signup({ email: 'later@example.com', password: 'password123' });
    expect(signup.ok && signup.user.role).toBe('viewer');
    await expect(auth.deleteUser(admin.id)).rejects.toBeInstanceOf(UserMutationError);
  });
});

describe('auth-managed collection — a refusal genuinely has no side effects', () => {
  it('no beforeOperation hook runs on a refused create/update/delete', async () => {
    // `beforeOperation` runs first, on every operation (before access checks, the existence lookup and
    // any read/write) — if the guard ran after it, a refusal would still have triggered a side effect.
    const beforeOperation = vi.fn();
    const managed = withAuthFields(
      defineCollection({
        slug: 'users',
        fields: {
          email: defineField.email({ required: true, unique: true }),
          name: defineField.text(),
          role: defineField.select({ options: ['admin', 'editor', 'viewer'] })
        },
        hooks: { beforeOperation: [beforeOperation] }
      })
    );
    const { runtime, admin } = await oneAdmin({ managedCollection: managed });
    beforeOperation.mockClear(); // oneAdmin's setup itself runs through auth.createUser, not hooks — clear defensively

    await expect(
      runtime.create({ collection: 'users', data: { email: 'x@example.com' } })
    ).rejects.toMatchObject(MANAGED);
    await expect(
      runtime.update({ collection: 'users', id: admin.id, data: { name: 'x' } })
    ).rejects.toMatchObject(MANAGED);
    await expect(runtime.delete({ collection: 'users', id: admin.id })).rejects.toMatchObject(
      MANAGED
    );

    expect(beforeOperation).not.toHaveBeenCalled();
  });
});

describe('auth-managed collection — the three concerns are distinct', () => {
  const posts = defineCollection({
    slug: 'posts',
    fields: {
      title: defineField.text({ required: true }),
      featured: defineField.boolean({ access: { write: ['admin'] } })
    },
    access: { create: ({ user }) => user !== null }
  });

  it('collection access and field access still answer FORBIDDEN on an ordinary collection', async () => {
    const { runtime } = await setup({ extraCollections: [posts] });

    // (1) collection access: an anonymous caller may not create.
    await expect(
      runtime.create({
        collection: 'posts',
        data: { title: 'x' },
        overrideAccess: false,
        user: null
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    // (2) field access: an editor may create, but not set an admin-only field.
    await expect(
      runtime.create({
        collection: 'posts',
        data: { title: 'x', featured: true },
        overrideAccess: false,
        user: { id: 'e1', role: 'editor' }
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    await expect(
      runtime.create({
        collection: 'posts',
        data: { title: 'x', featured: true },
        overrideAccess: false,
        user: { id: 'a1', role: 'admin' }
      })
    ).resolves.toMatchObject({ title: 'x', featured: true });
  });

  it('(3) lifecycle: the managed collection refuses even a caller that passes every access rule', async () => {
    const { runtime, admin } = await oneAdmin({ extraCollections: [posts] });
    await expect(
      runtime.update({
        collection: 'users',
        id: admin.id,
        data: { name: 'Renamed' },
        overrideAccess: false,
        user: { id: admin.id, role: 'admin' }
      })
    ).rejects.toMatchObject(MANAGED);
  });

  it('REPRODUCTION: a hand-rolled withAuthFields users collection let an editor promote themselves', async () => {
    // Shape used by apps/www and the demo: `withAuthFields` around a plain collection, `role` a plain
    // select with no field-level write rule, gated only by route `allowedRoles`.
    const staff = withAuthFields(
      defineCollection({
        slug: 'users',
        fields: {
          email: defineField.email({ required: true }),
          name: defineField.text(),
          role: defineField.select({ options: ['admin', 'editor', 'viewer'] })
        }
      })
    );
    const { runtime, auth, db } = await setup({ managedCollection: staff });
    await createUser(auth, 'admin@example.com');
    const editor = await createUser(auth, 'editor@example.com', 'editor');

    await expect(
      runtime.update({
        collection: 'users',
        id: editor.id,
        data: { role: 'admin' },
        overrideAccess: false,
        user: { id: editor.id, role: 'editor' }
      })
    ).rejects.toMatchObject(MANAGED);

    expect((await db.findById('users', editor.id))?.role).toBe('editor');
  });
});

describe('auth-managed collection — HTTP generic CRUD', () => {
  async function httpSetup() {
    const ctx = await oneAdmin();
    const viewer = await createUser(ctx.auth, 'viewer@example.com', 'viewer');
    const token = await bearerFor(ctx.auth, 'admin@example.com');
    return { ...ctx, viewer, token };
  }

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  it('POST /api/v1/users → 403 AUTH_MANAGED_COLLECTION in the standard error envelope', async () => {
    const { runtime, db, token } = await httpSetup();
    const before = await db.count('users');

    const response = await handleCreate(
      contextFor(
        new Request('https://forge.test/api/v1/users', {
          method: 'POST',
          headers: bearer(token),
          body: JSON.stringify({ email: 'new@example.com', role: 'admin' })
        }),
        { collection: 'users' }
      ),
      { runtime }
    );

    expect(response.status).toBe(403);
    const body = await json(response);
    expect(body.error?.code).toBe('AUTH_MANAGED_COLLECTION');
    expect(body.error?.message).toContain(
      "Collection 'users' is managed by the configured auth adapter"
    );
    expect(body.error?.details).toBeUndefined();
    expect(Object.keys(body)).toEqual(['error']);
    expect(await db.count('users')).toBe(before);
  });

  it.each(['PUT', 'PATCH'])(
    '%s /api/v1/users/:id → 403 and the role is unchanged',
    async (method) => {
      const { runtime, db, token, viewer } = await httpSetup();
      const response = await handleUpdate(
        contextFor(
          new Request(`https://forge.test/api/v1/users/${viewer.id}`, {
            method,
            headers: bearer(token),
            body: JSON.stringify({ role: 'admin' })
          }),
          { collection: 'users', id: viewer.id }
        ),
        { runtime }
      );
      expect(response.status).toBe(403);
      expect((await json(response)).error?.code).toBe('AUTH_MANAGED_COLLECTION');
      expect((await db.findById('users', viewer.id))?.role).toBe('viewer');
    }
  );

  it('DELETE /api/v1/users/:id → 403 and the last admin survives', async () => {
    const { runtime, db, token, admin } = await httpSetup();
    const response = await handleDelete(
      contextFor(
        new Request(`https://forge.test/api/v1/users/${admin.id}`, {
          method: 'DELETE',
          headers: bearer(token)
        }),
        { collection: 'users', id: admin.id }
      ),
      { runtime }
    );
    expect(response.status).toBe(403);
    expect((await json(response)).error?.code).toBe('AUTH_MANAGED_COLLECTION');
    expect(await db.findById('users', admin.id)).not.toBeNull();
  });

  it('a same-origin cookie session and an anonymous caller get the same deterministic 403, never a 500', async () => {
    const { runtime, token, viewer } = await httpSetup();
    const cookieResponse = await handleDelete(
      contextFor(
        new Request(`https://forge.test/api/v1/users/${viewer.id}`, {
          method: 'DELETE',
          headers: { cookie: `forge_session=${token}`, origin: 'https://forge.test' }
        }),
        { collection: 'users', id: viewer.id }
      ),
      { runtime }
    );
    expect(cookieResponse.status).toBe(403);
    expect((await json(cookieResponse)).error?.code).toBe('AUTH_MANAGED_COLLECTION');

    const anonymous = await handleUpdate(
      contextFor(
        new Request(`https://forge.test/api/v1/users/${viewer.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: 'x' })
        }),
        { collection: 'users', id: viewer.id }
      ),
      { runtime }
    );
    expect(anonymous.status).toBe(403);
    expect((await json(anonymous)).error?.code).toBe('AUTH_MANAGED_COLLECTION');
  });

  it('GET /api/v1/users and /:id keep working and never expose auth-owned fields', async () => {
    const { runtime, auth, token, viewer } = await httpSetup();
    // A password change writes `_sessionVersion` onto the row — it must not surface on reads.
    await auth.updateUser(viewer.id, { password: 'another-password-1' });

    const list = await handleList(
      contextFor(new Request('https://forge.test/api/v1/users', { headers: bearer(token) }), {
        collection: 'users'
      }),
      { runtime }
    );
    expect(list.status).toBe(200);
    const listBody = await json<{ data: Array<Record<string, unknown>>; meta: { count: number } }>(
      list
    );
    expect(listBody.data).toHaveLength(2);
    expect(listBody.meta.count).toBe(2);
    for (const doc of listBody.data) {
      expect(doc).not.toHaveProperty('passwordHash');
      expect(doc).not.toHaveProperty('_sessionVersion');
    }

    const read = await handleRead(
      contextFor(
        new Request(`https://forge.test/api/v1/users/${viewer.id}`, { headers: bearer(token) }),
        { collection: 'users', id: viewer.id }
      ),
      { runtime }
    );
    expect(read.status).toBe(200);
    const readBody = await json<{ data: Record<string, unknown> }>(read);
    expect(readBody.data.email).toBe('viewer@example.com');
    expect(readBody.data).not.toHaveProperty('passwordHash');
    expect(readBody.data).not.toHaveProperty('_sessionVersion');
  });

  it('POST with a multipart body on a managed upload-enabled collection never touches storage', async () => {
    // Reviewed finding: `handleCreate` used to parse multipart (uploading the file to storage) before
    // `runtime.create` ever ran its guard — refused, but only after a real (compensated) storage write,
    // and an orphaned object if the compensating delete itself failed. The check now runs first.
    const uploadableUsers = withAuthFields(
      defineCollection({
        slug: 'users',
        fields: {
          email: defineField.email({ required: true, unique: true }),
          name: defineField.text(),
          role: defineField.select({ options: ['admin', 'editor', 'viewer'] }),
          filename: defineField.text(),
          url: defineField.text(),
          contentType: defineField.text(),
          filesize: defineField.number()
        },
        upload: true
      })
    );
    const storage = new InMemoryStorageAdapter();
    const db = new InMemoryDatabaseAdapter();
    const auth = new UsersCollectionAuthAdapter({ devMode: true });
    const runtime = new ForgeCmsRuntime({
      collections: [uploadableUsers],
      adapters: { database: db, auth, storage },
      env: { userDatabase: db }
    });
    runtime.init();
    await runtime.syncSchema();
    const admin = await createUser(auth, 'admin@example.com');
    const token = await bearerFor(auth, 'admin@example.com');
    // Spying rather than asserting the end state: the pre-existing create-failure cleanup would empty
    // storage again even if the file WAS uploaded first, so only "put was never called at all" actually
    // distinguishes "refused before touching storage" from "uploaded, then compensated".
    const put = vi.spyOn(storage, 'put');

    const formData = new FormData();
    formData.set('file', new File(['bytes'], 'avatar.png', { type: 'image/png' }));

    const response = await handleCreate(
      contextFor(
        new Request('https://forge.test/api/v1/users', {
          method: 'POST',
          headers: bearer(token),
          body: formData
        }),
        { collection: 'users' }
      ),
      { runtime }
    );

    expect(response.status).toBe(403);
    expect((await json(response)).error?.code).toBe('AUTH_MANAGED_COLLECTION');
    expect(put).not.toHaveBeenCalled();
    expect(await storage.list()).toHaveLength(0);
    expect(await db.count('users')).toBe(1); // only the admin created above
    expect(await db.findById('users', admin.id)).not.toBeNull();
  });
});

describe('auth-managed collection — reads stay content reads', () => {
  const posts = defineCollection({
    slug: 'posts',
    fields: {
      title: defineField.text({ required: true }),
      author: defineField.relation({ collection: 'users' })
    }
  });

  it('find / findOne / findByID / count / depth-1 population still obey read access', async () => {
    const { runtime, auth, admin } = await oneAdmin({ extraCollections: [posts] });
    const viewer = await createUser(auth, 'viewer@example.com', 'viewer');
    const post = await runtime.create({
      collection: 'posts',
      data: { title: 'Hello', author: admin.id }
    });

    // `defineUsersCollection()` lets any authenticated user read, and no anonymous caller.
    const asViewer = { overrideAccess: false, user: { id: viewer.id, role: 'viewer' } } as const;
    const found = await runtime.find({ collection: 'users', ...asViewer });
    expect(found.totalDocs).toBe(2);
    expect(found.docs.every((doc) => !('passwordHash' in doc))).toBe(true);
    expect(await runtime.count({ collection: 'users', ...asViewer })).toBe(2);
    await expect(
      runtime.findByID({ collection: 'users', id: admin.id, ...asViewer })
    ).resolves.toMatchObject({ email: 'admin@example.com' });
    await expect(
      runtime.findOne({ collection: 'users', where: { email: 'viewer@example.com' }, ...asViewer })
    ).resolves.toMatchObject({ id: viewer.id });

    await expect(
      runtime.find({ collection: 'users', overrideAccess: false, user: null })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const populated = await runtime.findByID({
      collection: 'posts',
      id: post.id as string,
      depth: 1,
      overrideAccess: true
    });
    expect((populated as Record<string, unknown>).author).toMatchObject({
      email: 'admin@example.com'
    });
  });
});

describe('auth-managed collection — protection follows the configured slug, not the name', () => {
  it('protects `members` (managed) and leaves an unrelated `users` collection alone', async () => {
    const plainUsers = defineCollection({
      slug: 'users',
      fields: { email: defineField.email({ required: true }), nickname: defineField.text() }
    });
    const { runtime, auth, db } = await setup({
      slug: 'members',
      extraCollections: [plainUsers]
    });
    const admin = await createUser(auth, 'admin@example.com');
    expect(admin.role).toBe('admin');

    // `members` is the auth-managed collection.
    await expect(runtime.delete({ collection: 'members', id: admin.id })).rejects.toMatchObject(
      MANAGED
    );
    await expect(
      runtime.update({ collection: 'members', id: admin.id, data: { role: 'viewer' } })
    ).rejects.toMatchObject(MANAGED);
    await expect(
      runtime.create({ collection: 'members', data: { email: 'x@example.com' } })
    ).rejects.toMatchObject(MANAGED);
    expect(await db.count('members')).toBe(1);

    // `users` is just a collection here — full generic CRUD, no restriction by name.
    const created = await runtime.create({
      collection: 'users',
      data: { email: 'plain@example.com', nickname: 'p' }
    });
    const updated = await runtime.update({
      collection: 'users',
      id: created.id as string,
      data: { nickname: 'q' }
    });
    expect((updated as Record<string, unknown>).nickname).toBe('q');
    await expect(
      runtime.delete({ collection: 'users', id: created.id as string })
    ).resolves.toMatchObject({ id: created.id });

    // Reads on the managed collection are unchanged.
    await expect(runtime.find({ collection: 'members' })).resolves.toMatchObject({ totalDocs: 1 });
  });

  it('the dedicated surface on a renamed collection still works', async () => {
    const { auth, db } = await setup({ slug: 'accounts' });
    const first = await createUser(auth, 'first@example.com');
    expect(first.role).toBe('admin');
    const second = await createUser(auth, 'second@example.com', 'editor');
    await expect(auth.deleteUser(second.id)).resolves.toBeUndefined();
    await expect(auth.deleteUser(first.id)).rejects.toBeInstanceOf(UserMutationError);
    expect(await db.count('accounts')).toBe(1);
  });
});

describe('auth-managed collection — auth adapters', () => {
  it('a CompositeAuthAdapter containing the users adapter surfaces its managed collection', async () => {
    const { runtime, auth, db } = await setup({
      wrapAuth: (users, database) =>
        new CompositeAuthAdapter([
          users,
          new ApiKeyAuthAdapter().init({ apiKeyDatabase: database })
        ])
    });
    const admin = await createUser(auth, 'admin@example.com');

    await expect(runtime.delete({ collection: 'users', id: admin.id })).rejects.toMatchObject(
      MANAGED
    );
    expect(await db.count('users')).toBe(1);
  });

  it('a composite of adapters that manage nothing does not restrict any collection', async () => {
    const notes = defineCollection({ slug: 'users', fields: { name: defineField.text() } });
    const db = new InMemoryDatabaseAdapter();
    const runtime = new ForgeCmsRuntime({
      collections: [notes],
      adapters: {
        database: db,
        auth: new CompositeAuthAdapter([
          new ApiKeyAuthAdapter().init({ apiKeyDatabase: db }),
          new InMemoryAuthAdapter()
        ]),
        storage: new InMemoryStorageAdapter()
      }
    });
    runtime.init();
    await runtime.syncSchema();

    const created = await runtime.create({ collection: 'users', data: { name: 'a' } });
    await runtime.update({ collection: 'users', id: created.id as string, data: { name: 'b' } });
    await runtime.delete({ collection: 'users', id: created.id as string });
    expect(await db.count('users')).toBe(0);
  });

  it('a custom AuthAdapter that does not implement managesCollection is unaffected', async () => {
    const custom: AuthAdapter = {
      name: 'custom',
      init() {
        return custom;
      },
      extractToken: () => null,
      validateSession: async () => null,
      requireAuth: async () => {
        throw new Error('unused');
      }
    };
    expect('managesCollection' in custom).toBe(false);

    const db = new InMemoryDatabaseAdapter();
    const runtime = new ForgeCmsRuntime({
      collections: [defineCollection({ slug: 'users', fields: { name: defineField.text() } })],
      adapters: { database: db, auth: custom, storage: new InMemoryStorageAdapter() }
    });
    runtime.init();
    await runtime.syncSchema();

    const created = await runtime.create({ collection: 'users', data: { name: 'a' } });
    await expect(
      runtime.update({ collection: 'users', id: created.id as string, data: { name: 'b' } })
    ).resolves.toMatchObject({ name: 'b' });
    await expect(
      runtime.delete({ collection: 'users', id: created.id as string })
    ).resolves.toBeTruthy();
  });
});

describe('auth-managed collection — every mutation entry point funnels through the boundary', () => {
  it('restoreVersion on a versioned managed collection is refused', async () => {
    const { runtime, admin, db } = await oneAdmin({
      managedCollection: { ...defineUsersCollection(), versions: true }
    });
    const version = await runtime.createVersion({
      collection: 'users',
      documentId: admin.id,
      data: { email: 'admin@example.com', role: 'viewer' }
    });

    await expect(
      runtime.restoreVersion({ collection: 'users', versionId: version.id })
    ).rejects.toMatchObject(MANAGED);
    expect((await db.findById('users', admin.id))?.role).toBe('admin');

    // The refusal comes before the snapshot is even looked up, so it does not depend on the version id
    // (a missing version would otherwise answer 404 and reveal whether the id exists).
    await expect(
      runtime.restoreVersion({ collection: 'users', versionId: 'no-such-version' })
    ).rejects.toMatchObject(MANAGED);
  });

  describe('relation cascade / set-null cannot mutate a managed collection either', () => {
    const media = defineCollection({
      slug: 'media',
      fields: { filename: defineField.text({ required: true }) }
    });
    const withAvatar = (onDelete: 'set-null' | 'cascade' | 'restrict') =>
      withAuthFields(
        defineCollection({
          slug: 'users',
          fields: {
            email: defineField.email({ required: true, unique: true }),
            name: defineField.text(),
            role: defineField.select({ options: ['admin', 'editor', 'viewer'] }),
            avatar: defineField.relation({ collection: 'media', onDelete })
          }
        })
      );

    it.each(['set-null', 'cascade', 'restrict'] as const)(
      'onDelete: %s — deleting a referenced media document is refused before anything is written',
      async (onDelete) => {
        const { runtime, auth, db, admin } = await oneAdmin({
          managedCollection: withAvatar(onDelete),
          extraCollections: [media]
        });
        const image = await runtime.create({ collection: 'media', data: { filename: 'a.png' } });
        // Raw adapter access is below the runtime boundary (documented) — used here only to arrange state.
        await db.update('users', admin.id, { avatar: image.id });
        await createUser(auth, 'other@example.com', 'editor');

        const error = await runtime
          .delete({ collection: 'media', id: image.id as string })
          .then(() => null)
          .catch((err: unknown) => err as { status?: number; code?: string; message?: string });

        expect(error).toMatchObject({ status: 400, code: 'INVALID_INPUT' });
        if (onDelete !== 'restrict') {
          // The auth-managed-specific rejection must be honest that there is no supported remedy — it
          // must NOT say "remove the reference first" when nothing on the supported surface can (spec
          // 061 §3/§7: `updateUser` doesn't accept custom fields, and generic `update` of the managed
          // collection is exactly what this boundary refuses).
          expect(error?.message).toContain('managed by the configured auth adapter');
          expect(error?.message).toContain('outside runtime guarantees');
          expect(error?.message?.toLowerCase()).not.toContain('remove');
        }

        expect(await db.findById('media', image.id as string)).not.toBeNull();
        expect((await db.findById('users', admin.id))?.avatar).toBe(image.id);
        expect(await db.count('users')).toBe(2);
      }
    );

    it('an unreferenced media document still deletes normally', async () => {
      const { runtime, db } = await oneAdmin({
        managedCollection: withAvatar('set-null'),
        extraCollections: [media]
      });
      const image = await runtime.create({ collection: 'media', data: { filename: 'b.png' } });
      await runtime.delete({ collection: 'media', id: image.id as string });
      expect(await db.findById('media', image.id as string)).toBeNull();
    });

    // These two low-level `@forge-cms/runtime` exports are a *second* raw-adapter-write path into a
    // dependent collection, reachable without ever going through `operations.ts` (their documented
    // "no mutator supplied" fallback, pre-058) — so they must honor the boundary too (reviewed finding).
    // `media` is the target being deleted; `users` (managed) is the dependent side that references it.
    it('handleCascadeDelete called directly (no mutator) refuses to delete into a managed collection', async () => {
      const { runtime, db, admin } = await oneAdmin({
        managedCollection: withAvatar('cascade'),
        extraCollections: [media]
      });
      const image = await runtime.create({ collection: 'media', data: { filename: 'c.png' } });
      await db.update('users', admin.id, { avatar: image.id });

      await expect(handleCascadeDelete(runtime, media, image.id as string)).rejects.toMatchObject(
        MANAGED
      );
      expect((await db.findById('users', admin.id))?.avatar).toBe(image.id);
    });

    it('handleSetNullOnDelete called directly (no mutator) refuses to update a managed collection', async () => {
      const { runtime, db, admin } = await oneAdmin({
        managedCollection: withAvatar('set-null'),
        extraCollections: [media]
      });
      const image = await runtime.create({ collection: 'media', data: { filename: 'd.png' } });
      await db.update('users', admin.id, { avatar: image.id });

      await expect(handleSetNullOnDelete(runtime, media, image.id as string)).rejects.toMatchObject(
        MANAGED
      );
      expect((await db.findById('users', admin.id))?.avatar).toBe(image.id);
    });
  });
});

describe('auth-managed collection — raw DatabaseAdapter access is below the boundary (documented)', () => {
  it('runtime.adapters.database.update() is trusted low-level infrastructure and is not blocked', async () => {
    const { runtime, db, admin } = await oneAdmin();
    await runtime.adapters.database.update('users', admin.id, { name: 'Written directly' });
    expect((await db.findById('users', admin.id))?.name).toBe('Written directly');
  });
});
