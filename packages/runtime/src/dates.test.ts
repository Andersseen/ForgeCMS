import { describe, expect, it } from 'vitest';
import { defineBlock, defineCollection, defineField, defineGlobal } from '@forge-cms/core';
import { InMemoryDatabaseAdapter, LibSqlDatabaseAdapter } from '@forge-cms/db';
import type { DatabaseAdapter } from '@forge-cms/db';
import type { CollectionDefinition } from '@forge-cms/core';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';
import { handleRead } from './handlers.js';
import { canonicalizeDates } from './dates.js';

/**
 * Spec 076 (demo finding 24): one date representation — the `toISOString()` string — at rest, on Local
 * API reads and on the wire, whatever a write carried and whichever adapter stores it.
 */
const events = defineCollection({
  slug: 'events',
  fields: {
    title: defineField.text({ required: true }),
    startsAt: defineField.date({ withTime: true }),
    venue: defineField.group({ fields: { openedOn: defineField.date() } }),
    sessions: defineField.array({ fields: { at: defineField.date() } }),
    layout: defineField.blocks({
      blocks: [defineBlock({ slug: 'countdown', fields: { until: defineField.date() } })]
    })
  }
});
const settings = defineGlobal({ slug: 'settings', fields: { launchAt: defineField.date() } });

const ISO = '2026-01-15T10:30:00.000Z';

/** Untyped on purpose: the runtime accepts numeric timestamps, which the typed input type does not advertise. */
function build(database: DatabaseAdapter) {
  const runtime = new ForgeCmsRuntime({
    collections: [events as CollectionDefinition],
    globals: [settings],
    adapters: {
      database,
      auth: new InMemoryAuthAdapter(),
      storage: new InMemoryStorageAdapter()
    }
  });
  runtime.init();
  return runtime;
}

async function readOverHttp(runtime: ReturnType<typeof build>, id: string) {
  const response = await handleRead(
    {
      request: new Request(`http://forge.test/api/v1/events/${id}`),
      params: { collection: 'events', id },
      env: undefined
    },
    { runtime }
  );
  return ((await response.json()) as { data: Record<string, unknown> }).data;
}

const adapters: [string, () => DatabaseAdapter][] = [
  ['InMemory', () => new InMemoryDatabaseAdapter()],
  ['libSQL', () => new LibSqlDatabaseAdapter(':memory:')]
];

describe.each(adapters)('date representation on %s (spec 076)', (_name, makeAdapter) => {
  it.each([
    ['a Date', new Date(ISO)],
    ['an ISO string', ISO],
    ['a numeric timestamp', Date.parse(ISO)],
    ['an offset string', '2026-01-15T11:30:00.000+01:00']
  ])('stores and returns %s as the canonical ISO string', async (_label, startsAt) => {
    const runtime = build(makeAdapter());
    await runtime.syncSchema();
    const created = await runtime.create({ collection: 'events', data: { title: 'x', startsAt } });

    expect(created.startsAt).toBe(ISO);
    expect((await runtime.findByID({ collection: 'events', id: created.id })).startsAt).toBe(ISO);
    expect((await readOverHttp(runtime, created.id))['startsAt']).toBe(ISO);
  });

  it('canonicalizes a date-only string and nested dates', async () => {
    const runtime = build(makeAdapter());
    await runtime.syncSchema();
    const created = await runtime.create({
      collection: 'events',
      data: {
        title: 'nested',
        startsAt: '2026-01-15',
        venue: { openedOn: new Date('2020-05-01T00:00:00Z') },
        sessions: [{ at: Date.parse(ISO) }],
        layout: [{ blockType: 'countdown', until: '2026-02-01' }]
      }
    });
    const wire = await readOverHttp(runtime, created.id);

    expect(wire['startsAt']).toBe('2026-01-15T00:00:00.000Z');
    expect(wire['venue']).toEqual({ openedOn: '2020-05-01T00:00:00.000Z' });
    expect(wire['sessions']).toEqual([{ at: ISO }]);
    expect(wire['layout']).toEqual([{ blockType: 'countdown', until: '2026-02-01T00:00:00.000Z' }]);
  });

  it('canonicalizes on update and on a global write', async () => {
    const runtime = build(makeAdapter());
    await runtime.syncSchema();
    const created = await runtime.create({ collection: 'events', data: { title: 'u' } });
    const updated = await runtime.update({
      collection: 'events',
      id: created.id,
      data: { startsAt: Date.parse(ISO) }
    });
    expect(updated.startsAt).toBe(ISO);

    const global = await runtime.updateGlobalDocument({
      global: 'settings',
      data: { launchAt: new Date(ISO) }
    });
    expect(global?.['launchAt']).toBe(ISO);
    expect((await runtime.getGlobalDocument({ global: 'settings' }))?.['launchAt']).toBe(ISO);
  });

  it('still rejects an unparseable date', async () => {
    const runtime = build(makeAdapter());
    await runtime.syncSchema();
    await expect(
      runtime.create({ collection: 'events', data: { title: 'bad', startsAt: 'not a date' } })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('canonicalizeDates', () => {
  it('returns the same object when nothing changes', () => {
    const data = { title: 'x', startsAt: ISO };
    expect(canonicalizeDates(events.fields, data)).toBe(data);
  });

  it('leaves null, absent and invalid values to validation', () => {
    const data = { startsAt: null, venue: { openedOn: 'nope' } };
    expect(canonicalizeDates(events.fields, data)).toBe(data);
  });

  it('previews with the stored representation', async () => {
    const runtime = build(new InMemoryDatabaseAdapter());
    await runtime.syncSchema();
    const preview = await runtime.preview({
      collection: 'events',
      data: { title: 'p', startsAt: Date.parse(ISO) }
    });
    expect(preview['startsAt']).toBe(ISO);
  });
});
