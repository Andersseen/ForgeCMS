import { afterAll, describe, expect, it } from 'vitest';
import { defineCollection, defineField, defineGlobal } from '@forge-cms/core';
import type { GlobalDefinition } from '@forge-cms/core';
import { InMemoryDatabaseAdapter, LibSqlDatabaseAdapter } from '@forge-cms/db';
import type { DatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import {
  globalLifecycleGlobals,
  runGlobalLifecycleContractTests
} from '@forge-cms/testing/contracts';
import { ForgeCmsRuntime } from './runtime.js';
import { handleGlobalRead, handleGlobalUpdate } from './handlers.js';
import { validateGlobalSchema } from './globals.js';

// Spec 066 — global document lifecycle (D04, globals).

const tempDir = await (async () => {
  const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as {
    mkdtempSync(prefix: string): string;
    rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
  };
  const os = (await import(/* @vite-ignore */ 'node:os' as string)) as { tmpdir(): string };
  return {
    make: () => fs.mkdtempSync(`${os.tmpdir()}/forge-globals-`),
    remove: (path: string) => fs.rmSync(path, { recursive: true, force: true })
  };
})();

function runtimeOver(database: DatabaseAdapter, globals: GlobalDefinition[]): ForgeCmsRuntime {
  const runtime = new ForgeCmsRuntime({
    collections: [],
    globals,
    adapters: { database, auth: new InMemoryAuthAdapter(), storage: new InMemoryStorageAdapter() }
  });
  runtime.init();
  return runtime;
}

const site = (overrides: Partial<GlobalDefinition> = {}) =>
  defineGlobal({
    slug: 'site',
    drafts: true,
    locales: ['en', 'es'],
    fields: {
      title: defineField.text({ required: true }),
      theme: defineField.text({ defaultValue: 'light' }),
      region: defineField.text(),
      slug: defineField.slug({ autoGenerate: true, sourceField: 'title' }),
      tagline: defineField.text({ localized: true })
    },
    ...overrides
  });

async function setup(global: GlobalDefinition = site()) {
  const database = new InMemoryDatabaseAdapter();
  const runtime = runtimeOver(database, [global]);
  await runtime.syncSchema();
  const row = () => database.findById('_global_site', 'global');
  return { database, runtime, row };
}

const admin = { id: 'u1', role: 'admin' } as const;

describe('global partial updates (spec 066)', () => {
  it('keeps omitted fields: required, defaulted and the draft status are not reset', async () => {
    const { runtime, row } = await setup();
    await runtime.updateGlobalDocument({
      global: 'site',
      data: { title: 'Hello', theme: 'dark', _status: 'published' }
    });

    // Pre-fix: VALIDATION_ERROR (title required), and with title sent, theme → 'light' and _status → 'draft'.
    await runtime.updateGlobalDocument({ global: 'site', data: { region: 'eu' } });
    expect(await row()).toMatchObject({
      title: 'Hello',
      theme: 'dark',
      region: 'eu',
      _status: 'published'
    });
  });

  it('applies defaults and the draft status on the first write only', async () => {
    const { runtime, row } = await setup();
    await runtime.updateGlobalDocument({ global: 'site', data: { title: 'Hello World' } });
    expect(await row()).toMatchObject({ theme: 'light', _status: 'draft' });
  });

  it('still reports a required field the caller clears', async () => {
    const { runtime } = await setup();
    await runtime.updateGlobalDocument({ global: 'site', data: { title: 'Hello' } });
    await expect(
      runtime.updateGlobalDocument({ global: 'site', data: { title: '' } })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('auto-generates the slug on the first write and keeps it when the title changes', async () => {
    const { runtime, row } = await setup();
    await runtime.updateGlobalDocument({ global: 'site', data: { title: 'Hello World' } });
    expect((await row())?.slug).toBe('hello-world');
    await runtime.updateGlobalDocument({ global: 'site', data: { title: 'Renamed' } });
    expect((await row())?.slug).toBe('hello-world');
  });

  it('passes previousData to beforeValidate hooks on later writes', async () => {
    const seen: unknown[] = [];
    const { runtime } = await setup(
      site({
        hooks: {
          beforeValidate: [
            ({ previousData, data }) => {
              seen.push(previousData?.title);
              return data;
            }
          ]
        }
      })
    );
    await runtime.updateGlobalDocument({ global: 'site', data: { title: 'One' } });
    await runtime.updateGlobalDocument({ global: 'site', data: { title: 'Two' } });
    expect(seen).toEqual([undefined, 'One']);
  });
});

describe('global localization (spec 066)', () => {
  it('writes one locale and keeps the others; reads resolve with fallback', async () => {
    const { runtime, row } = await setup();
    await runtime.updateGlobalDocument({ global: 'site', data: { title: 'T' } });
    await runtime.updateGlobalDocument({ global: 'site', locale: 'en', data: { tagline: 'hi' } });
    await runtime.updateGlobalDocument({ global: 'site', locale: 'es', data: { tagline: 'hola' } });

    expect((await row())?.tagline).toEqual({ en: 'hi', es: 'hola' });
    expect(await runtime.getGlobalDocument({ global: 'site', locale: 'es' })).toMatchObject({
      tagline: 'hola'
    });
    // Without a locale the stored map is returned whole, as for a collection.
    expect((await runtime.getGlobalDocument({ global: 'site' }))?.tagline).toEqual({
      en: 'hi',
      es: 'hola'
    });
  });

  it('refuses writing a locale the global does not declare', async () => {
    const { runtime, row } = await setup();
    await runtime.updateGlobalDocument({ global: 'site', data: { title: 'T' } });
    await expect(
      runtime.updateGlobalDocument({ global: 'site', locale: 'fr', data: { tagline: 'salut' } })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect((await row())?.tagline).toBeUndefined();
  });

  it('serves ?locale= over HTTP for read and update', async () => {
    const { runtime } = await setup();
    await runtime.updateGlobalDocument({ global: 'site', data: { title: 'T' } });
    const options = { runtime };
    const put = await handleGlobalUpdate(
      {
        request: new Request('http://x/api/v1/globals/site?locale=es', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tagline: 'hola' })
        }),
        params: { global: 'site' },
        env: undefined
      },
      options
    );
    expect(put.status).toBe(200);
    const get = await handleGlobalRead(
      {
        request: new Request('http://x/api/v1/globals/site?locale=es'),
        params: { global: 'site' },
        env: undefined
      },
      options
    );
    // Draft globals are hidden from anonymous reads; publish first.
    expect(get.status).toBe(404);
    await runtime.updateGlobalDocument({ global: 'site', data: { _status: 'published' } });
    const published = await handleGlobalRead(
      {
        request: new Request('http://x/api/v1/globals/site?locale=es'),
        params: { global: 'site' },
        env: undefined
      },
      options
    );
    expect(((await published.json()) as { data: Record<string, unknown> }).data.tagline).toBe(
      'hola'
    );
  });
});

describe('global access queries (spec 066)', () => {
  const scoped = () =>
    site({
      access: {
        read: ({ user }) => (user ? { region: 'eu' } : false),
        update: ({ user }) => (user ? { region: 'eu' } : false)
      }
    });

  it('a read rule returning a query hides a row it does not match', async () => {
    const { runtime } = await setup(scoped());
    await runtime.updateGlobalDocument({ global: 'site', data: { title: 'T', region: 'us' } });
    // Pre-fix: the query was ignored and the row returned.
    expect(
      await runtime.getGlobalDocument({ global: 'site', user: admin, overrideAccess: false })
    ).toBeNull();
    await runtime.updateGlobalDocument({ global: 'site', data: { region: 'eu' } });
    expect(
      await runtime.getGlobalDocument({ global: 'site', user: admin, overrideAccess: false })
    ).toMatchObject({ title: 'T' });
  });

  it('an update rule returning a query must match the stored row, and cannot authorize the first write', async () => {
    const { runtime, row } = await setup(scoped());
    await expect(
      runtime.updateGlobalDocument({
        global: 'site',
        user: admin,
        overrideAccess: false,
        data: { title: 'T', region: 'eu' }
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await row()).toBeNull();

    await runtime.updateGlobalDocument({ global: 'site', data: { title: 'T', region: 'us' } });
    await expect(
      runtime.updateGlobalDocument({
        global: 'site',
        user: admin,
        overrideAccess: false,
        data: { title: 'x' }
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await row())?.title).toBe('T');

    await runtime.updateGlobalDocument({ global: 'site', data: { region: 'eu' } });
    await runtime.updateGlobalDocument({
      global: 'site',
      user: admin,
      overrideAccess: false,
      data: { title: 'x' }
    });
    expect((await row())?.title).toBe('x');
  });
});

describe('global startup validation (spec 066)', () => {
  it('refuses options a global can never apply', () => {
    const errors = validateGlobalSchema([
      defineGlobal({
        slug: 'a',
        access: { create: () => true, delete: () => true },
        hooks: { beforeDelete: [() => undefined], afterDelete: [() => undefined] },
        fields: { t: defineField.text({ localized: true }) }
      })
    ]);
    expect(errors).toHaveLength(4);
    expect(errors.join('\n')).toMatch(/beforeDelete.*afterDelete.*access\.create.*access\.delete/s);
    expect(() =>
      runtimeOver(new InMemoryDatabaseAdapter(), [
        defineGlobal({ slug: 'a', access: { create: () => true }, fields: {} })
      ])
    ).toThrow(/Unsupported global\/localization configuration/);
  });

  it('refuses localized fields no read or write can honour, on collections and globals', () => {
    const build = (
      fields: Record<string, ReturnType<typeof defineField.text>>,
      locales?: string[]
    ) =>
      runtimeOver(new InMemoryDatabaseAdapter(), [
        defineGlobal({ slug: 'g', fields, ...(locales !== undefined && { locales }) })
      ]);
    expect(() => build({ t: defineField.text({ localized: true }) })).toThrow(
      /no locales are declared/
    );
    expect(() => build({ n: defineField.number({ localized: true }) as never }, ['en'])).toThrow(
      /localized number field/
    );
    expect(() =>
      build(
        { g: defineField.group({ fields: { t: defineField.text({ localized: true }) } }) as never },
        ['en']
      )
    ).toThrow(/'g\.t' is localized inside a group/);
    expect(
      () =>
        new ForgeCmsRuntime({
          collections: [
            defineCollection({
              slug: 'c',
              fields: { b: defineField.boolean({ localized: true }) },
              locales: ['en']
            })
          ],
          adapters: {
            database: new InMemoryDatabaseAdapter(),
            auth: new InMemoryAuthAdapter(),
            storage: new InMemoryStorageAdapter()
          }
        })
    ).toThrow(/Collection 'c': field 'b' is a localized boolean field/);
  });

  it('accepts every supported shape', () => {
    expect(validateGlobalSchema([site()])).toEqual([]);
  });
});

// --- two-writer contract ------------------------------------------------------------------------------

describe('InMemoryDatabaseAdapter (one process, runtimes share the adapter instance)', () => {
  runGlobalLifecycleContractTests(async ({ prefix, parties, gate }) => {
    const shared = new InMemoryDatabaseAdapter();
    const contenders = [];
    for (let i = 0; i < parties; i++) {
      const runtime = runtimeOver(gate.wrap(shared), globalLifecycleGlobals(prefix));
      await runtime.syncSchema();
      contenders.push(runtime);
    }
    return { contenders, database: shared };
  });
});

describe('LibSqlDatabaseAdapter — independent clients on one database file', () => {
  const directory = tempDir.make();
  afterAll(() => tempDir.remove(directory));

  runGlobalLifecycleContractTests(async ({ prefix, parties, gate }) => {
    const url = `file:${directory}/${prefix}.db`;
    const contenders = [];
    for (let i = 0; i < parties; i++) {
      const runtime = runtimeOver(
        gate.wrap(new LibSqlDatabaseAdapter(url).init()),
        globalLifecycleGlobals(prefix)
      );
      await runtime.syncSchema();
      contenders.push(runtime);
    }
    const raw = runtimeOver(new LibSqlDatabaseAdapter(url).init(), globalLifecycleGlobals(prefix));
    await raw.syncSchema();
    return { contenders, database: raw.adapters.database };
  });
});
