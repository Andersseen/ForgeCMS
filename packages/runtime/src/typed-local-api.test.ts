/**
 * Compile-time coverage for the typed Local API (spec 047). These assertions are checked for real
 * by `pnpm typecheck` (`.test.ts` files are included in `tsconfig.json`, unlike `tsconfig.build.json`)
 * — `expectTypeOf` calls are no-ops at runtime, and `@ts-expect-error` lines live inside a function
 * that is declared but never invoked, so nothing here affects the (trivial) runtime assertions below.
 */
import { describe, expectTypeOf, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import type { CollectionDefinition } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';

interface Metadata {
  featured: boolean;
}

const posts = defineCollection({
  slug: 'posts',
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({ required: true }),
    views: defineField.number(),
    metadata: defineField.json<Metadata>(),
    untypedData: defineField.json()
  }
});

const authors = defineCollection({
  slug: 'authors',
  fields: {
    name: defineField.text({ required: true })
  }
});

function buildTypedRuntime() {
  return new ForgeCmsRuntime({
    collections: [posts, authors],
    adapters: {
      database: new InMemoryDatabaseAdapter(),
      auth: new InMemoryAuthAdapter(),
      storage: new InMemoryStorageAdapter()
    }
  });
}

describe('typed Local API (compile-time only)', () => {
  it('infers the collection slug union from the registered collections', () => {
    type Runtime = ReturnType<typeof buildTypedRuntime>;
    expectTypeOf<Parameters<Runtime['find']>[0]['collection']>().toEqualTypeOf<
      'posts' | 'authors'
    >();
  });

  it('infers find() and findByID() result document types', async () => {
    const runtime = buildTypedRuntime();
    await runtime.create({ collection: 'posts', data: { title: 'Hello', slug: 'hello' } });
    const author = await runtime.create({ collection: 'authors', data: { name: 'Ada' } });

    const page = await runtime.find({ collection: 'posts' });
    expectTypeOf(page.docs[0]!.title).toEqualTypeOf<string>();
    expectTypeOf(page.docs[0]!.views).toEqualTypeOf<number>();
    expectTypeOf(page.docs[0]!.id).toEqualTypeOf<string>();
    expectTypeOf(page.docs[0]!.created_at).toEqualTypeOf<string>();
    expectTypeOf(page.docs[0]!.updated_at).toEqualTypeOf<string>();

    const byId = await runtime.findByID({ collection: 'authors', id: author.id });
    expectTypeOf(byId.name).toEqualTypeOf<string>();
  });

  it('types create()/update() data and their returned documents', async () => {
    const runtime = buildTypedRuntime();

    const created = await runtime.create({
      collection: 'posts',
      data: { title: 'Hello', slug: 'hello', views: 1 }
    });
    expectTypeOf(created.title).toEqualTypeOf<string>();
    expectTypeOf(created.views).toEqualTypeOf<number>();
    expectTypeOf(created.id).toEqualTypeOf<string>();

    const updated = await runtime.update({
      collection: 'posts',
      id: created.id,
      data: { views: 2 }
    });
    expectTypeOf(updated.views).toEqualTypeOf<number>();

    const author = await runtime.create({ collection: 'authors', data: { name: 'Ada' } });
    const deleted = await runtime.delete({ collection: 'authors', id: author.id });
    expectTypeOf(deleted.name).toEqualTypeOf<string>();
  });

  it('carries a typed JSON generic through, and leaves untyped JSON as unknown', async () => {
    const runtime = buildTypedRuntime();

    const created = await runtime.create({
      collection: 'posts',
      data: { title: 'Hello', slug: 'hello', metadata: { featured: true } }
    });
    expectTypeOf(created.metadata).toEqualTypeOf<Metadata>();
    expectTypeOf(created.untypedData).toEqualTypeOf<unknown>();
  });

  it('constrains sort/where field names to known collection fields', async () => {
    const runtime = buildTypedRuntime();
    // Known collection/document fields are accepted for both `sort` and `where` keys — the
    // rejection side (`sort: 'doesNotExist'`, `where: { doesNotExist: ... }`) is covered by the
    // `@ts-expect-error` cases below.
    const page = await runtime.find({
      collection: 'posts',
      sort: 'views',
      where: { title: 'Hello', id: 'x' }
    });
    expectTypeOf(page.docs).not.toBeAny();
  });

  it('rejects invalid usage at compile time (never executed)', () => {
    async function invalidUsage(runtime: ReturnType<typeof buildTypedRuntime>) {
      // @ts-expect-error - unknown collection is rejected
      await runtime.find({ collection: 'does-not-exist' });

      // @ts-expect-error - wrong field value type is rejected
      await runtime.create({ collection: 'posts', data: { views: 'not-a-number' } });

      // @ts-expect-error - unknown field name is rejected
      await runtime.create({ collection: 'posts', data: { nope: 1 } });

      // @ts-expect-error - unknown sort field is rejected
      await runtime.find({ collection: 'posts', sort: 'doesNotExist' });

      // @ts-expect-error - unknown where field is rejected
      await runtime.find({ collection: 'posts', where: { doesNotExist: 'x' } });
    }
    void invalidUsage;
  });

  it('keeps a broad/backward-compatible registry working with plain strings', async () => {
    // A consumer that widens on purpose (or builds the array dynamically) keeps compiling: no
    // literal slug union is available, but every method still accepts any collection string and
    // returns a loosely-typed (not `any`) document, same spirit as today's `DatabaseRecord`.
    const broadCollections: CollectionDefinition[] = [posts, authors];
    const broadRuntime = new ForgeCmsRuntime({
      collections: broadCollections,
      adapters: {
        database: new InMemoryDatabaseAdapter(),
        auth: new InMemoryAuthAdapter(),
        storage: new InMemoryStorageAdapter()
      }
    });

    // 'posts' is a real registered collection (compile-time, any string is accepted here since the
    // registry is broad — this just needs a collection that actually exists to run without error).
    const page = await broadRuntime.find({ collection: 'posts' });
    expectTypeOf(page.docs).not.toBeAny();
  });

  it('preserves ForgeCmsRuntime<TEnv> compatibility for consumers giving only the env type', () => {
    interface MyEnv {
      DB?: unknown;
    }
    function explicitEnvOnly(runtime: ForgeCmsRuntime<MyEnv>) {
      // Still compiles and accepts a plain string — see spec 047's Design section for why this
      // path can't also keep literal collection-slug narrowing (a TypeScript limitation, not a
      // choice made here): pass both type args (`ForgeCmsRuntime<MyEnv, typeof collections>`) for
      // full inference.
      void runtime.find({ collection: 'anything' });
    }
    void explicitEnvOnly;
  });
});
