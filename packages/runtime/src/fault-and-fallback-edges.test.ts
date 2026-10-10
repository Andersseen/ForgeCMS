import { describe, expect, it } from 'vitest';
import { defineCollection, defineField, defineGlobal } from '@forge-cms/core';
import type { CollectionDefinition } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';
import { findOrphanedDocuments } from './relation-integrity.js';
import {
  extractLocaleFromRequest,
  getLocalizedValue,
  resolveLocale,
  setLocalizedValue
} from './localization.js';

// Spec 089 — deterministic fault, access-denial and fallback evidence for branches the behaviour
// matrix marks critical: row-scoped delete races, global access/write faults, versions disabled,
// cascade cycles, orphans in many-relations, and the locale fallback chain.

async function build(
  collections: CollectionDefinition[],
  globals: ReturnType<typeof defineGlobal>[] = []
) {
  const database = new InMemoryDatabaseAdapter();
  const auth = new InMemoryAuthAdapter();
  const runtime = new ForgeCmsRuntime({
    collections,
    globals,
    adapters: { database, auth, storage: new InMemoryStorageAdapter() }
  });
  runtime.init();
  await runtime.syncSchema();
  return { database, runtime };
}

describe('row-scoped delete', () => {
  const notes = defineCollection({
    slug: 'notes',
    access: {
      read: () => true,
      create: () => true,
      delete: ({ user }) => (user ? { owner: user.id } : false)
    },
    fields: { text: defineField.text(), owner: defineField.text() }
  });
  const alice = { id: 'alice', role: 'editor' } as never;

  it('deletes only the caller’s own rows', async () => {
    const { runtime, database } = await build([notes]);
    const mine = await runtime.create({ collection: 'notes', data: { text: 'm', owner: 'alice' } });
    const theirs = await runtime.create({ collection: 'notes', data: { text: 't', owner: 'bob' } });
    await runtime.delete({
      collection: 'notes',
      id: mine.id as string,
      user: alice,
      overrideAccess: false
    });
    expect(await database.findById('notes', mine.id as string)).toBeNull();
    await expect(
      runtime.delete({
        collection: 'notes',
        id: theirs.id as string,
        user: alice,
        overrideAccess: false
      })
    ).rejects.toThrow();
    expect(await database.findById('notes', theirs.id as string)).not.toBeNull();
  });

  it('a row that moves out of scope between check and delete is a 409, one that vanished a 404', async () => {
    const { runtime, database } = await build([notes]);
    const row = await runtime.create({ collection: 'notes', data: { text: 'm', owner: 'alice' } });
    const id = row.id as string;

    // The database refuses the conditional delete (the row changed under the caller).
    const realDeleteIf = database.deleteIf.bind(database);
    database.deleteIf = async () => ({ applied: false }) as never;
    await expect(
      runtime.delete({ collection: 'notes', id, user: alice, overrideAccess: false })
    ).rejects.toMatchObject({ status: 409 });
    expect(await database.findById('notes', id)).not.toBeNull();

    // Same refusal, but the row is gone: not a conflict, simply not found.
    database.deleteIf = async () => {
      await database.delete('notes', id);
      return { applied: false } as never;
    };
    await expect(
      runtime.delete({ collection: 'notes', id, user: alice, overrideAccess: false })
    ).rejects.toMatchObject({ status: 404 });
    database.deleteIf = realDeleteIf;
  });
});

describe('versions and globals', () => {
  it('version operations on a collection without history fail clearly and write nothing', async () => {
    const plain = defineCollection({ slug: 'plain', fields: { t: defineField.text() } });
    const { runtime } = await build([plain]);
    const doc = await runtime.create({ collection: 'plain', data: { t: 'x' } });
    await expect(
      runtime.listVersions({ collection: 'plain', documentId: doc.id as string })
    ).rejects.toThrow(/does not have versions enabled/);
    await expect(runtime.getVersion({ collection: 'plain', versionId: 'v' })).rejects.toThrow();
    await expect(
      runtime.listVersions({ collection: 'missing', documentId: '1' })
    ).rejects.toMatchObject({
      status: 404
    });
  });

  it('a global with a denying read rule is invisible to an untrusted caller but readable by trusted code', async () => {
    const secret = defineGlobal({
      slug: 'secret_settings',
      access: {
        read: ({ user }) => user?.role === 'admin',
        update: ({ user }) => user?.role === 'admin'
      },
      fields: { token: defineField.text() }
    });
    const { runtime } = await build([], [secret]);
    await runtime.updateGlobalDocument({ global: 'secret_settings', data: { token: 't' } });

    await expect(
      runtime.getGlobalDocument({ global: 'secret_settings', user: null, overrideAccess: false })
    ).rejects.toMatchObject({ status: 403 }); // the HTTP layer maps an anonymous 403 to 401
    await expect(
      runtime.getGlobalDocument({
        global: 'secret_settings',
        user: { id: 'v', role: 'viewer' } as never,
        overrideAccess: false
      })
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      runtime.updateGlobalDocument({
        global: 'secret_settings',
        data: { token: 'hijack' },
        user: { id: 'v', role: 'viewer' } as never,
        overrideAccess: false
      })
    ).rejects.toMatchObject({ status: 403 });
    expect((await runtime.getGlobalDocument({ global: 'secret_settings' }))?.token).toBe('t');
  });

  it('a database fault during a global write propagates and leaves the stored value unchanged', async () => {
    const site = defineGlobal({ slug: 'site', fields: { name: defineField.text() } });
    const { runtime, database } = await build([], [site]);
    await runtime.updateGlobalDocument({ global: 'site', data: { name: 'before' } });
    const realUpdate = database.update.bind(database);
    const realAtomic = database.atomicWrite.bind(database);
    database.update = async () => {
      throw new Error('disk I/O error');
    };
    database.atomicWrite = async () => {
      throw new Error('disk I/O error');
    };
    await expect(
      runtime.updateGlobalDocument({ global: 'site', data: { name: 'after' } })
    ).rejects.toThrow('disk I/O error');
    database.update = realUpdate;
    database.atomicWrite = realAtomic;
    expect((await runtime.getGlobalDocument({ global: 'site' }))?.name).toBe('before');
  });

  it('an unknown or unsupported global locale is rejected before writing', async () => {
    const plain = defineGlobal({ slug: 'plain_global', fields: { name: defineField.text() } });
    const { runtime } = await build([], [plain]);
    await expect(
      runtime.updateGlobalDocument({ global: 'plain_global', data: { name: 'x' }, locale: 'fr' })
    ).rejects.toThrow(/not localized/);
  });
});

describe('relation integrity', () => {
  it('a cascade cycle terminates and removes both sides', async () => {
    const a = defineCollection({
      slug: 'a',
      fields: { b: defineField.relation({ collection: 'b', onDelete: 'cascade' }) }
    });
    const b = defineCollection({
      slug: 'b',
      fields: { a: defineField.relation({ collection: 'a', onDelete: 'cascade' }) }
    });
    const { runtime, database } = await build([a, b]);
    const docA = await runtime.create({ collection: 'a', data: {} });
    const docB = await runtime.create({ collection: 'b', data: { a: docA.id } });
    await runtime.update({ collection: 'a', id: docA.id as string, data: { b: docB.id } });

    await runtime.delete({ collection: 'a', id: docA.id as string });
    expect(await database.findById('a', docA.id as string)).toBeNull();
    expect(await database.findById('b', docB.id as string)).toBeNull();
  });

  it('reports dangling ids inside many-relations and single relations', async () => {
    const tags = defineCollection({ slug: 'tags', fields: { name: defineField.text() } });
    const posts = defineCollection({
      slug: 'posts',
      fields: {
        tags: defineField.relation({ collection: 'tags', many: true }),
        main: defineField.relation({ collection: 'tags' })
      }
    });
    const { runtime, database } = await build([tags, posts]);
    const tag = await runtime.create({ collection: 'tags', data: { name: 't' } });
    // Written behind the pipeline (a restore, a manual SQL edit): references to rows that do not exist.
    await database.create('posts', { tags: [tag.id, 'ghost-1', 42], main: 'ghost-2' });
    const orphans = await findOrphanedDocuments(runtime, runtime.getCollection('posts')!);
    expect(orphans.map((o) => [o.fieldName, o.missingId]).sort()).toEqual([
      ['main', 'ghost-2'],
      ['tags', 'ghost-1']
    ]);
  });
});

describe('locale resolution and fallback', () => {
  it('resolves exact, language, language-prefix and default locales', () => {
    expect(resolveLocale(undefined, ['en', 'es'])).toBe('en');
    expect(resolveLocale('es', [])).toBe('en');
    expect(resolveLocale('es', ['en', 'es'])).toBe('es');
    expect(resolveLocale('es-MX', ['en', 'es'])).toBe('es');
    expect(resolveLocale('pt', ['en', 'pt-BR'])).toBe('pt-BR');
    expect(resolveLocale('de', ['en', 'es'])).toBe('en');
  });

  it('reads a localized value through the fallback chain and tolerates non-map values', () => {
    const value = { en: 'Hello', es: 'Hola', 'pt-BR': 'Oi' };
    expect(getLocalizedValue(value, 'es', ['en', 'es'])).toBe('Hola');
    expect(getLocalizedValue(value, 'es-MX', ['en', 'es'])).toBe('Hola');
    expect(getLocalizedValue({ en: 'Hello' }, 'de', ['en', 'es'])).toBe('Hello');
    expect(getLocalizedValue({ fr: 'Salut' }, 'de', ['en', 'es'])).toBe('Salut');
    expect(getLocalizedValue({}, 'de', ['en'])).toBeUndefined();
    expect(getLocalizedValue('plain', 'en', ['en'])).toBe('plain');
    expect(getLocalizedValue(['x'], 'en', ['en'])).toEqual(['x']);
    expect(setLocalizedValue({ en: 'a' }, 'es', 'b')).toEqual({ en: 'a', es: 'b' });
  });

  it('detects the request locale from the query first, then a q-weighted Accept-Language', () => {
    const collection = defineCollection({
      slug: 'pages',
      locales: ['en', 'es', 'pt'],
      fields: { title: defineField.text({ localized: true }) }
    });
    const req = (url: string, accept?: string) =>
      new Request(url, accept ? { headers: { 'accept-language': accept } } : {});
    expect(extractLocaleFromRequest(req('http://x/?locale=es', 'pt'), collection)).toBe('es');
    expect(
      extractLocaleFromRequest(req('http://x/?locale=zz', 'pt;q=0.4, es;q=0.9'), collection)
    ).toBe('es');
    expect(extractLocaleFromRequest(req('http://x/', 'fr, pt-BR;q=0.8'), collection)).toBe('pt');
    expect(extractLocaleFromRequest(req('http://x/', 'fr, de'), collection)).toBeUndefined();
    expect(extractLocaleFromRequest(req('http://x/'), collection)).toBeUndefined();
  });
});
