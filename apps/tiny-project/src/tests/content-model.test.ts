import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { collections } from '../server/api/collections';

/**
 * Unit-level proof of this fixture's own content model and role rules, against InMemory adapters —
 * fast, no HTTP. The slower, real proofs (real libSQL, real local D1, a real browser) live in
 * `src/tests/portable-libsql.integration.test.ts`, `test/workers/*.test.ts`, and `e2e/*.spec.ts`.
 */
describe('tiny-project content model', () => {
  let runtime: ForgeCmsRuntime;

  beforeEach(async () => {
    const database = new InMemoryDatabaseAdapter();
    const auth = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: database });
    runtime = new ForgeCmsRuntime({
      collections,
      adapters: { database, auth, storage: new InMemoryStorageAdapter() }
    });
    runtime.init();
    await runtime.syncSchema();
  });

  it('bootstraps the first-ever user to admin regardless of the create call', async () => {
    const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;
    const result = await auth.createUser({ email: 'first@example.com', password: 'password123' });
    if (!result.ok) throw new Error('expected success');
    expect(result.user.role).toBe('admin');
  });

  it('a slug auto-generates from title and must be unique', async () => {
    const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;
    const admin = await auth.createUser({ email: 'admin@example.com', password: 'password123' });
    if (!admin.ok) throw new Error('expected success');

    const post = await runtime.create({
      collection: 'posts',
      data: { title: 'Hello World', author: admin.user.id }
    });
    expect(post['slug']).toBe('hello-world');

    await expect(
      runtime.create({
        collection: 'posts',
        data: { title: 'Hello World', slug: 'hello-world', author: admin.user.id }
      })
    ).rejects.toThrow();
  });

  it('a draft post is invisible to an anonymous read, visible to an authenticated one', async () => {
    const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;
    const admin = await auth.createUser({ email: 'admin2@example.com', password: 'password123' });
    if (!admin.ok) throw new Error('expected success');

    await runtime.create({
      collection: 'posts',
      data: { title: 'Draft Post', author: admin.user.id }
    });

    const anonymous = await runtime.find({
      collection: 'posts',
      overrideAccess: false,
      user: null
    });
    expect(anonymous.docs).toHaveLength(0);

    const asAdmin = await runtime.find({
      collection: 'posts',
      overrideAccess: false,
      user: admin.user,
      status: 'all'
    });
    expect(asAdmin.docs).toHaveLength(1);
  });

  it('an editor can write posts but only an admin can delete', async () => {
    const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;
    const admin = await auth.createUser({ email: 'admin3@example.com', password: 'password123' });
    if (!admin.ok) throw new Error('expected success');
    const editor = await auth.createUser({
      email: 'editor@example.com',
      password: 'password123',
      role: 'editor'
    });
    if (!editor.ok) throw new Error('expected success');

    const post = await runtime.create({
      collection: 'posts',
      overrideAccess: false,
      user: editor.user,
      data: { title: 'Editor Post', author: admin.user.id }
    });

    await expect(
      runtime.delete({
        collection: 'posts',
        overrideAccess: false,
        user: editor.user,
        id: String(post['id'])
      })
    ).rejects.toThrow();

    await expect(
      runtime.delete({
        collection: 'posts',
        overrideAccess: false,
        user: admin.user,
        id: String(post['id'])
      })
    ).resolves.toBeTruthy();
  });

  it('a viewer cannot create a post', async () => {
    const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;
    const admin = await auth.createUser({ email: 'admin4@example.com', password: 'password123' });
    if (!admin.ok) throw new Error('expected success');
    const viewer = await auth.createUser({
      email: 'viewer@example.com',
      password: 'password123',
      role: 'viewer'
    });
    if (!viewer.ok) throw new Error('expected success');

    await expect(
      runtime.create({
        collection: 'posts',
        overrideAccess: false,
        user: viewer.user,
        data: { title: 'Should Fail', author: admin.user.id }
      })
    ).rejects.toThrow();
  });

  it('the relation field populates the author document at depth 1', async () => {
    const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;
    const admin = await auth.createUser({ email: 'admin5@example.com', password: 'password123' });
    if (!admin.ok) throw new Error('expected success');

    const created = await runtime.create({
      collection: 'posts',
      data: { title: 'Relation Post', author: admin.user.id }
    });

    const populated = await runtime.findByID({
      collection: 'posts',
      id: String(created['id']),
      depth: 1
    });
    expect(populated).not.toBeNull();
    const author = (populated as Record<string, unknown>)['author'] as Record<string, unknown>;
    expect(author['email']).toBe('admin5@example.com');
  });
});
