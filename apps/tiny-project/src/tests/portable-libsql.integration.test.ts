import { beforeAll, describe, expect, it } from 'vitest';
import { LibSqlDatabaseAdapter } from '@forge-cms/db';
import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { collections } from '../server/api/collections';

/**
 * Spec 055 §17/§40: proves the exact same small-project domain (users + posts, drafts, one
 * relation, role-gated writes) runs against a real libSQL database — not `InMemoryDatabaseAdapter`
 * — with **no Cloudflare binding of any kind**. This is the "ForgeCMS is Cloudflare-first, not
 * Cloudflare-locked" claim, proven rather than asserted. Mirrors the real-local-D1 proof pattern
 * spec 051 established (`packages/cloudflare/test/workers/*.test.ts`), for the portable profile.
 */
describe('portable libSQL profile — full small-project server lifecycle', () => {
  let database: LibSqlDatabaseAdapter;
  let runtime: ForgeCmsRuntime;

  beforeAll(async () => {
    // A fresh, real (not mocked) libSQL database per test run, entirely in memory — no file, no
    // network, no Cloudflare binding.
    database = new LibSqlDatabaseAdapter('file::memory:').init();
    const auth = new UsersCollectionAuthAdapter({ devMode: true }).init({ userDatabase: database });
    runtime = new ForgeCmsRuntime({
      collections,
      adapters: { database, auth, storage: new InMemoryStorageAdapter() }
    });
    runtime.init();
    await runtime.syncSchema();
  });

  it('bootstraps the first admin, signs in, and creates a second (editor) user', async () => {
    const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;

    const admin = await auth.createUser({ email: 'owner@tiny.test', password: 'password123' });
    if (!admin.ok) throw new Error(`expected success, got ${JSON.stringify(admin)}`);
    expect(admin.user.role).toBe('admin');

    const login = await auth.login('owner@tiny.test', 'password123');
    expect(login.ok).toBe(true);

    const editor = await auth.createUser({
      email: 'editor@tiny.test',
      password: 'password123',
      role: 'editor'
    });
    if (!editor.ok) throw new Error('expected success');
    expect(editor.user.role).toBe('editor');
  });

  it('creates, updates, publishes, and deletes a post; drafts stay invisible anonymously', async () => {
    const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;
    const admin = await auth.login('owner@tiny.test', 'password123');
    if (!admin.ok) throw new Error('expected success');

    const created = await runtime.create({
      collection: 'posts',
      overrideAccess: false,
      user: admin.user,
      data: { title: 'Portable Post', author: admin.user.id }
    });
    expect(created['slug']).toBe('portable-post');
    expect(created['_status']).toBe('draft');

    const anonymousBeforePublish = await runtime.find({
      collection: 'posts',
      overrideAccess: false,
      user: null
    });
    expect(anonymousBeforePublish.docs).toHaveLength(0);

    const updated = await runtime.update({
      collection: 'posts',
      overrideAccess: false,
      user: admin.user,
      id: String(created['id']),
      data: { title: 'Portable Post (updated)', _status: 'published' }
    });
    expect(updated['title']).toBe('Portable Post (updated)');
    expect(updated['_status']).toBe('published');

    const anonymousAfterPublish = await runtime.find({
      collection: 'posts',
      overrideAccess: false,
      user: null,
      depth: 1
    });
    expect(anonymousAfterPublish.docs).toHaveLength(1);
    const author = anonymousAfterPublish.docs[0]?.['author'] as Record<string, unknown> | undefined;
    expect(author?.['email']).toBe('owner@tiny.test');

    await runtime.delete({
      collection: 'posts',
      overrideAccess: false,
      user: admin.user,
      id: String(created['id'])
    });

    const afterDelete = await runtime.find({
      collection: 'posts',
      overrideAccess: false,
      user: admin.user,
      status: 'all'
    });
    expect(afterDelete.docs).toHaveLength(0);
  });

  it('a real unique-slug conflict throws through the real libSQL unique index', async () => {
    const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;
    const admin = await auth.login('owner@tiny.test', 'password123');
    if (!admin.ok) throw new Error('expected success');

    await runtime.create({
      collection: 'posts',
      overrideAccess: false,
      user: admin.user,
      data: { title: 'Duplicate Slug', slug: 'dup', author: admin.user.id }
    });

    await expect(
      runtime.create({
        collection: 'posts',
        overrideAccess: false,
        user: admin.user,
        data: { title: 'Another Title', slug: 'dup', author: admin.user.id }
      })
    ).rejects.toThrow();
  });
});
