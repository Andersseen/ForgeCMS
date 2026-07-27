/**
 * Spec 040 — the core gaps the `apps/demo-aesthetics` build turned up.
 *
 * Each case here is a finding from docs/DEMO-FINDINGS.md that used to require a workaround in the
 * app: populated uploads (9), field defaults and auto-slugs (1), hooks knowing whether the caller
 * was trusted (19), and serving stored files (21).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { defineCollection, defineField } from '@forge-cms/core';
import type { BaseHookArgs, HookContext } from '@forge-cms/core';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { ForgeCmsRuntime } from './runtime.js';
import { handleFile } from './files.js';

const media = defineCollection({
  slug: 'media',
  upload: true,
  fields: {
    filename: defineField.text({ required: true }),
    url: defineField.text(),
    alt: defineField.text()
  }
});

const services = defineCollection({
  slug: 'services',
  fields: {
    name: defineField.text({ required: true }),
    slug: defineField.slug({ autoGenerate: true, sourceField: 'name' }),
    image: defineField.upload({ collection: 'media' }),
    status: defineField.select({ options: ['draft', 'live'], defaultValue: 'draft' }),
    price: defineField.number({ defaultValue: 0 })
  }
});

function buildRuntime(collections: Parameters<typeof defineCollection>[0][]) {
  const runtime = new ForgeCmsRuntime({
    collections,
    adapters: {
      database: new InMemoryDatabaseAdapter(),
      auth: new InMemoryAuthAdapter(),
      storage: new InMemoryStorageAdapter()
    }
  });
  runtime.init();
  return runtime;
}

describe('depth: 1 populates upload fields (finding 9)', () => {
  let runtime: ForgeCmsRuntime;
  let imageId: string;

  beforeEach(async () => {
    runtime = buildRuntime([media, services]);
    const image = await runtime.create({
      collection: 'media',
      data: { filename: 'facial.jpg', url: '/api/media/media/facial.jpg', alt: 'A facial' }
    });
    imageId = String(image.id);
    await runtime.create({ collection: 'services', data: { name: 'Facial', image: imageId } });
  });

  it('returns the media document instead of a bare id on find', async () => {
    const { docs } = await runtime.find({ collection: 'services', depth: 1 });
    const image = docs[0]?.image as Record<string, unknown>;

    expect(image.id).toBe(imageId);
    expect(image.url).toBe('/api/media/media/facial.jpg');
  });

  it('does the same on findByID', async () => {
    const { docs } = await runtime.find({ collection: 'services' });
    const doc = await runtime.findByID({
      collection: 'services',
      id: String(docs[0]?.id),
      depth: 1
    });

    expect((doc.image as Record<string, unknown>).alt).toBe('A facial');
  });

  it('leaves the id alone without depth', async () => {
    const { docs } = await runtime.find({ collection: 'services' });
    expect(docs[0]?.image).toBe(imageId);
  });

  it('nulls an upload pointing at a document that no longer exists', async () => {
    await runtime.delete({ collection: 'media', id: imageId });
    const { docs } = await runtime.find({ collection: 'services', depth: 1 });

    expect(docs[0]?.image).toBeNull();
  });
});

describe('defaults and auto-slugs in the write pipeline (finding 1)', () => {
  let runtime: ForgeCmsRuntime;

  beforeEach(() => {
    runtime = buildRuntime([media, services]);
  });

  it('applies defaultValue on create', async () => {
    const doc = await runtime.create({ collection: 'services', data: { name: 'Peel' } });

    expect(doc.status).toBe('draft');
    expect(doc.price).toBe(0);
  });

  it('generates the slug with no hook in the collection', async () => {
    const doc = await runtime.create({
      collection: 'services',
      data: { name: 'Laser hair removal — medium area' }
    });

    expect(doc.slug).toBe('laser-hair-removal-medium-area');
  });

  it('does not re-apply defaults on update', async () => {
    const created = await runtime.create({
      collection: 'services',
      data: { name: 'Peel', status: 'live' }
    });
    const updated = await runtime.update({
      collection: 'services',
      id: String(created.id),
      data: { price: 120 }
    });

    expect(updated.status).toBe('live');
  });

  it('keeps the slug stable when the name changes', async () => {
    const created = await runtime.create({ collection: 'services', data: { name: 'Peel' } });
    const updated = await runtime.update({
      collection: 'services',
      id: String(created.id),
      data: { name: 'Deep peel' }
    });

    expect(updated.slug).toBe('peel');
  });
});

describe('hooks can tell trusted calls apart (finding 19)', () => {
  it('passes overrideAccess to collection and field hooks', async () => {
    const seen: { collectionHook?: boolean | undefined; fieldHook?: boolean | undefined } = {};

    const bookings = defineCollection({
      slug: 'bookings',
      fields: {
        email: defineField.email({ required: true }),
        status: defineField.text({
          hooks: {
            beforeChange: [
              (args) => {
                seen.fieldHook = args.overrideAccess;
                return args.overrideAccess === true ? args.value : 'pending';
              }
            ]
          }
        })
      },
      hooks: {
        beforeChange: [
          (ctx: HookContext) => {
            seen.collectionHook = ctx.overrideAccess;
            return ctx.data;
          }
        ]
      },
      access: { create: () => true }
    });

    const runtime = buildRuntime([bookings]);

    const trusted = await runtime.create({
      collection: 'bookings',
      data: { email: 'staff@example.com', status: 'confirmed' }
    });
    expect(seen.collectionHook).toBe(true);
    expect(seen.fieldHook).toBe(true);
    // The whole point: server-side code keeps the value it wrote.
    expect(trusted.status).toBe('confirmed');

    const fromTheStreet = await runtime.create({
      collection: 'bookings',
      overrideAccess: false,
      user: null,
      data: { email: 'visitor@example.com', status: 'confirmed' }
    });
    expect(seen.collectionHook).toBe(false);
    expect(fromTheStreet.status).toBe('pending');
  });

  it('passes it to read and delete hooks too', async () => {
    const seen: (boolean | undefined)[] = [];
    const notes = defineCollection({
      slug: 'notes',
      fields: { body: defineField.text() },
      hooks: {
        beforeOperation: [(ctx: BaseHookArgs) => void seen.push(ctx.overrideAccess)],
        afterRead: [
          (ctx) => {
            seen.push(ctx.overrideAccess);
            return ctx.doc;
          }
        ]
      }
    });

    const runtime = buildRuntime([notes]);
    await runtime.create({ collection: 'notes', data: { body: 'hi' } });
    seen.length = 0;

    await runtime.find({ collection: 'notes', overrideAccess: false, user: null });

    expect(seen).toEqual([false, false]);
  });
});

describe('handleFile serves stored bytes (finding 21)', () => {
  let runtime: ForgeCmsRuntime;

  beforeEach(async () => {
    runtime = buildRuntime([media]);
    await runtime.adapters.storage.put({
      key: 'media/logo.svg',
      body: new TextEncoder().encode('<svg />'),
      contentType: 'image/svg+xml'
    });
  });

  it('returns the object with its content type', async () => {
    const response = await handleFile(
      {
        request: new Request('http://x/api/media/media/logo.svg'),
        params: { key: 'media/logo.svg' },
        env: undefined
      },
      { runtime }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/svg+xml');
    expect(await response.text()).toBe('<svg />');
  });

  it('decodes an encoded key', async () => {
    const response = await handleFile(
      { request: new Request('http://x/'), params: { key: 'media%2Flogo.svg' }, env: undefined },
      { runtime }
    );

    expect(response.status).toBe(200);
  });

  it('404s an unknown key and 400s a missing one', async () => {
    const missing = await handleFile(
      { request: new Request('http://x/'), params: { key: 'media/nope.svg' }, env: undefined },
      { runtime }
    );
    const noKey = await handleFile(
      { request: new Request('http://x/'), params: {}, env: undefined },
      { runtime }
    );

    expect(missing.status).toBe(404);
    expect(noKey.status).toBe(400);
  });

  it('points getPublicUrl at a path an app can actually serve', async () => {
    expect(await runtime.adapters.storage.getPublicUrl('media/logo.svg')).toBe(
      '/api/media/media/logo.svg'
    );
  });
});
