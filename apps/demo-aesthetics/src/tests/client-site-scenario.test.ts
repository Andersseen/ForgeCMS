import { describe, expect, it } from 'vitest';
import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { collections, globals } from '../scenarios/client-site-collections';

// The "client site" scenario of the Agent Kit guide (spec 093): siteSettings, pages, services, posts and media in
// Spanish and English. The guide embeds this exact file, so the supported localization contract is proven against
// the REAL runtime - not described.

async function buildRuntime(): Promise<ForgeCmsRuntime> {
  const database = new InMemoryDatabaseAdapter();
  const auth = new UsersCollectionAuthAdapter().init({
    AUTH_SECRET: 'client-site-scenario-secret-0123456789abcdef',
    userDatabase: database
  });
  const runtime = new ForgeCmsRuntime({
    collections,
    globals,
    adapters: { database, auth, storage: new InMemoryStorageAdapter() },
    env: { AUTH_SECRET: 'client-site-scenario-secret-0123456789abcdef' }
  });
  runtime.init();
  await runtime.syncSchema();
  return runtime;
}

describe('client site scenario (es + en)', () => {
  it('is accepted at startup: only top-level text/textarea are localized', async () => {
    await expect(buildRuntime()).resolves.toBeDefined();
  });

  it('keeps ES and EN independent and resolves by locale', async () => {
    const runtime = await buildRuntime();
    const created = await runtime.create({
      collection: 'services',
      locale: 'es',
      data: {
        title: 'Tratamientos',
        description: 'Descripción en español',
        _status: 'published'
      }
    });
    await runtime.update({
      collection: 'services',
      id: String(created.id),
      locale: 'en',
      data: { title: 'Treatments' }
    });

    const asVisitor = { overrideAccess: false, user: null } as const;
    const es = await runtime.find({ collection: 'services', locale: 'es', ...asVisitor });
    const en = await runtime.find({ collection: 'services', locale: 'en', ...asVisitor });
    expect(es.docs[0]?.['title']).toBe('Tratamientos');
    expect(en.docs[0]?.['title']).toBe('Treatments');
    // The English description was never written: it falls back to the first declared locale (es).
    expect(en.docs[0]?.['description']).toBe('Descripción en español');

    // Changing ES afterwards does not overwrite EN.
    await runtime.update({
      collection: 'services',
      id: String(created.id),
      locale: 'es',
      data: { title: 'Tratamientos faciales' }
    });
    const again = await runtime.findByID({
      collection: 'services',
      id: String(created.id),
      locale: 'en'
    });
    expect(again['title']).toBe('Treatments');

    // Without a locale, the whole map comes back.
    const map = await runtime.findByID({ collection: 'services', id: String(created.id) });
    expect(map['title']).toEqual({ es: 'Tratamientos faciales', en: 'Treatments' });
  });

  it('localizes the site settings global per locale', async () => {
    const runtime = await buildRuntime();
    await runtime.updateGlobalDocument({
      global: 'siteSettings',
      locale: 'es',
      data: { siteName: 'Clínica Sol' }
    });
    await runtime.updateGlobalDocument({
      global: 'siteSettings',
      locale: 'en',
      data: { siteName: 'Sun Clinic' }
    });
    const es = await runtime.getGlobalDocument({ global: 'siteSettings', locale: 'es' });
    const en = await runtime.getGlobalDocument({ global: 'siteSettings', locale: 'en' });
    expect(es?.['siteName']).toBe('Clínica Sol');
    expect(en?.['siteName']).toBe('Sun Clinic');
  });

  it('refuses the shapes the guide says are unsupported (localized richtext, nested, upload)', async () => {
    const { defineCollection, defineField } = await import('@forge-cms/core');
    const make = (
      fields: Record<string, ReturnType<(typeof defineField)[keyof typeof defineField]>>
    ) =>
      new ForgeCmsRuntime({
        collections: [defineCollection({ slug: 'x', locales: ['es', 'en'], fields })],
        adapters: {
          database: new InMemoryDatabaseAdapter(),
          auth: new UsersCollectionAuthAdapter().init({ AUTH_SECRET: 'x'.repeat(40) }),
          storage: new InMemoryStorageAdapter()
        },
        env: { AUTH_SECRET: 'x'.repeat(40) }
      });
    expect(() => make({ body: defineField.richtext({ localized: true } as never) })).toThrow();
    expect(() => make({ n: defineField.number({ localized: true } as never) })).toThrow();
    expect(() =>
      make({ g: defineField.group({ fields: { t: defineField.text({ localized: true }) } }) })
    ).toThrow();
  });
});
