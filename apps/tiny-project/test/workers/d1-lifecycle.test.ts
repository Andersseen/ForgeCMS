import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { D1DatabaseAdapter } from '@forge-cms/cloudflare';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { collections } from '../../src/server/api/collections.js';

/**
 * Spec 055 §16/§22/§39: the same small-project domain (users + posts, drafts, one relation,
 * role-gated writes) proven against a real local D1 binding — not the mock, not InMemory — via
 * `@forge-cms/cloudflare`'s public `D1DatabaseAdapter` only. Mirrors
 * `packages/cloudflare/test/workers/human-auth.test.ts`'s pattern; this file proves the *fixture's*
 * own collections, not `@forge-cms/cloudflare`'s adapter internals (already covered there).
 *
 * One `it()` for the whole lifecycle rather than several: `@cloudflare/vitest-plugin` isolates
 * storage per test case by default, so splitting this into independent `it()`s that assume an
 * earlier one's rows still exist would be flaky depending on isolation config — sequencing
 * everything inside one test avoids relying on that.
 */
describe('real local D1 — full small-project server lifecycle', () => {
  it('syncs schema, bootstraps the first admin, and runs the full post lifecycle + role boundary', async () => {
    // Not pre-initialized: `ForgeCmsRuntime.init()` below calls `database.init(env)` itself (it
    // re-initializes every adapter with `config.env`), so `env` is passed through the runtime
    // config instead — matching apps/www's `buildRuntime`. `auth.init()` still needs its own upfront
    // call for `userDatabase`, which the runtime's generic re-init call doesn't know to pass; that
    // second call is safe (`UsersCollectionAuthAdapter.init` only touches `userDatabase` when the
    // option is actually provided, so it doesn't clear what this call sets).
    const database = new D1DatabaseAdapter();
    const auth = new UsersCollectionAuthAdapter({ devMode: true }).init({
      ...env,
      userDatabase: database
    });
    const runtime = new ForgeCmsRuntime({
      collections,
      adapters: { database, auth, storage: new InMemoryStorageAdapter() },
      env
    });
    runtime.init();
    await runtime.syncSchema();

    const admin = await auth.createUser({ email: 'owner@d1.test', password: 'password123' });
    if (!admin.ok) throw new Error(`expected success, got ${JSON.stringify(admin)}`);
    expect(admin.user.role).toBe('admin');

    const editor = await auth.createUser({
      email: 'editor@d1.test',
      password: 'password123',
      role: 'editor'
    });
    if (!editor.ok) throw new Error('expected success');

    const created = await runtime.create({
      collection: 'posts',
      overrideAccess: false,
      user: editor.user,
      data: { title: 'D1 Post', author: admin.user.id }
    });
    expect(created['slug']).toBe('d1-post');
    expect(created['_status']).toBe('draft');

    const anonymousBeforePublish = await runtime.find({
      collection: 'posts',
      overrideAccess: false,
      user: null
    });
    expect(anonymousBeforePublish.docs).toHaveLength(0);

    await runtime.update({
      collection: 'posts',
      overrideAccess: false,
      user: admin.user,
      id: String(created['id']),
      data: { _status: 'published' }
    });

    const anonymousAfterPublish = await runtime.find({
      collection: 'posts',
      overrideAccess: false,
      user: null,
      depth: 1
    });
    expect(anonymousAfterPublish.docs).toHaveLength(1);
    const author = anonymousAfterPublish.docs[0]?.['author'] as Record<string, unknown> | undefined;
    expect(author?.['email']).toBe('owner@d1.test');

    // Real D1 unique index on `slug`, not just an in-process pre-check.
    await expect(
      runtime.create({
        collection: 'posts',
        overrideAccess: false,
        user: admin.user,
        data: { title: 'Another Title', slug: 'd1-post', author: admin.user.id }
      })
    ).rejects.toThrow();

    // Role boundary: an editor may write posts but not delete them; only an admin may.
    await expect(
      runtime.delete({
        collection: 'posts',
        overrideAccess: false,
        user: editor.user,
        id: String(created['id'])
      })
    ).rejects.toThrow();

    await expect(
      runtime.delete({
        collection: 'posts',
        overrideAccess: false,
        user: admin.user,
        id: String(created['id'])
      })
    ).resolves.toBeTruthy();

    // Role boundary: an editor may never manage users (not gated by the generic `posts` access rule
    // at all — this exercises `defineUsersCollection()`'s own `access.create`, `isAdmin(user)`).
    await expect(
      runtime.create({
        collection: 'users',
        overrideAccess: false,
        user: editor.user,
        data: { email: 'nope@d1.test' }
      })
    ).rejects.toThrow();
  });
});
