/**
 * Content-model tests, driven through the Local API against a real in-memory runtime.
 *
 * They live in `src/tests/` rather than next to the code they cover (the repo's usual colocation
 * rule): Nitro bundles **everything** under `src/server/**` into the worker, so a `*.test.ts` there
 * pulls `vitest` into the server bundle and the API crashes on the first request.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AccessDeniedError, NotFoundError, ValidationFailedError } from '@forge-cms/runtime';
import type { ForgeCmsRuntime } from '@forge-cms/runtime';
import type { CmsUser } from '@forge-cms/core';
import { createRuntime, type ServerEnv } from '../server/api/runtime';
import { seedContent } from '../server/api/seed';

const STAFF: CmsUser = { id: 'staff-1', email: 'frontdesk@lumea.clinic', role: 'editor' };
const CLIENT: CmsUser = { id: 'client-1', email: 'lucia@example.com', role: 'viewer' };

/** How the public site reads: as nobody, with access control on. */
const AS_VISITOR = { overrideAccess: false, user: null } as const;

let cms: ForgeCmsRuntime<ServerEnv>;

beforeEach(async () => {
  cms = createRuntime();
  await cms.syncSchema();
  await seedContent(cms);
});

describe('services', () => {
  it('hides drafts from the public site but shows them to server code', async () => {
    const visitorView = await cms.find({ collection: 'services', limit: 50, ...AS_VISITOR });
    const serverView = await cms.find({ collection: 'services', limit: 50 });

    expect(visitorView.docs.every((doc) => doc._status === 'published')).toBe(true);
    expect(serverView.totalDocs).toBe(visitorView.totalDocs + 1);
    expect(serverView.docs.some((doc) => doc.name === 'Bridal glow programme')).toBe(true);
  });

  it('derives the slug from the name when the editor leaves it blank', async () => {
    const created = await cms.create({
      collection: 'services',
      data: {
        name: 'Deep Cleanse & Extraction',
        slug: '',
        summary: 'A clarifying treatment for congested skin.',
        durationMinutes: 45,
        price: 70
      }
    });

    expect(created.slug).toBe('deep-cleanse-extraction');
  });

  it('rounds prices to two decimals in a beforeChange hook', async () => {
    const created = await cms.create({
      collection: 'services',
      data: {
        name: 'Rounding check',
        slug: '',
        summary: 'Checks the price hook.',
        durationMinutes: 30,
        price: 49.999
      }
    });

    expect(created.price).toBe(50);
  });

  it('rejects a duration outside the clinic range', async () => {
    await expect(
      cms.create({
        collection: 'services',
        data: {
          name: 'Impossible marathon facial',
          slug: '',
          summary: 'Too long to be real.',
          durationMinutes: 900,
          price: 10
        }
      })
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('keeps composite fields (array + group) intact through a round trip', async () => {
    const found = await cms.find({
      collection: 'services',
      where: { slug: 'signature-hydraglow-facial' },
      limit: 1,
      ...AS_VISITOR
    });
    const [service] = found.docs;

    expect(Array.isArray(service?.benefits)).toBe(true);
    expect((service?.benefits as unknown[]).length).toBe(3);
    expect((service?.aftercare as Record<string, unknown>).sessionsRecommended).toBe(4);
  });
});

describe('bookings access control', () => {
  it('lets an anonymous visitor create a request', async () => {
    const booking = await cms.create({
      collection: 'bookings',
      ...AS_VISITOR,
      data: {
        name: 'Nora P.',
        email: 'Nora@Example.com  ',
        preferredDate: new Date().toISOString()
      }
    });

    expect(booking.id).toBeDefined();
    // beforeValidate normalises the address the visitor typed.
    expect(booking.email).toBe('nora@example.com');
  });

  it('forces a public create to land as pending, whatever the body says', async () => {
    const booking = await cms.create({
      collection: 'bookings',
      ...AS_VISITOR,
      data: {
        name: 'Optimistic visitor',
        email: 'optimist@example.com',
        preferredDate: new Date().toISOString(),
        // `status` is staff-write-only, so the hook — not the body — decides.
        source: 'crafted'
      }
    });

    expect(booking.status).toBe('pending');
  });

  it('rejects a public create that tries to set a staff-only field', async () => {
    await expect(
      cms.create({
        collection: 'bookings',
        ...AS_VISITOR,
        data: {
          name: 'Sneaky visitor',
          email: 'sneaky@example.com',
          preferredDate: new Date().toISOString(),
          status: 'confirmed'
        }
      })
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it('shows nothing to an anonymous reader', async () => {
    await expect(cms.find({ collection: 'bookings', ...AS_VISITOR })).rejects.toBeInstanceOf(
      AccessDeniedError
    );
  });

  it('shows staff the whole inbox', async () => {
    const inbox = await cms.find({ collection: 'bookings', overrideAccess: false, user: STAFF });
    expect(inbox.totalDocs).toBe(2);
  });

  it('shows a signed-in client only their own bookings', async () => {
    const mine = await cms.find({ collection: 'bookings', overrideAccess: false, user: CLIENT });

    expect(mine.totalDocs).toBe(1);
    expect(mine.docs[0]?.email).toBe(CLIENT.email);
    // The row-level constraint narrows the total too, not just the page.
    expect(mine.docs.every((doc) => doc.email === CLIENT.email)).toBe(true);
  });

  it('hides staff-only fields from a client read', async () => {
    const mine = await cms.find({ collection: 'bookings', overrideAccess: false, user: CLIENT });
    expect(mine.docs[0]).not.toHaveProperty('internalNotes');
  });

  it('404s rather than 403s when a client reads someone else’s booking by id', async () => {
    const all = await cms.find({ collection: 'bookings' });
    const other = all.docs.find((doc) => doc.email !== CLIENT.email);

    await expect(
      cms.findByID({
        collection: 'bookings',
        id: String(other?.id),
        overrideAccess: false,
        user: CLIENT
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('promotions', () => {
  it('only exposes active campaigns to the public site', async () => {
    const publicView = await cms.find({ collection: 'promotions', ...AS_VISITOR });
    const staffView = await cms.find({
      collection: 'promotions',
      overrideAccess: false,
      user: STAFF
    });

    expect(publicView.totalDocs).toBe(1);
    expect(publicView.docs[0]?.title).toBe('Spring skin reset');
    expect(staffView.totalDocs).toBe(2);
  });
});

describe('posts', () => {
  it('derives reading time from the richtext body', async () => {
    const found = await cms.find({
      collection: 'posts',
      where: { topic: 'skin' },
      limit: 5,
      ...AS_VISITOR
    });

    expect(found.docs.length).toBeGreaterThan(0);
    expect(found.docs.every((doc) => typeof doc.readingMinutes === 'number')).toBe(true);
    expect(found.docs.every((doc) => (doc.readingMinutes as number) >= 1)).toBe(true);
  });

  it('keeps unpublished announcements off the site', async () => {
    const publicView = await cms.find({ collection: 'posts', limit: 20, ...AS_VISITOR });
    expect(publicView.docs.some((doc) => String(doc.title).includes('Thursday'))).toBe(false);
  });
});

describe('pages', () => {
  it('stores the home page as an ordered list of blocks', async () => {
    const found = await cms.find({
      collection: 'pages',
      where: { slug: 'home' },
      limit: 1,
      ...AS_VISITOR
    });
    const sections = found.docs[0]?.sections as { blockType: string }[];

    expect(sections.map((section) => section.blockType)).toEqual([
      'hero',
      'stat_band',
      'featured_services',
      'rich_text',
      'testimonials',
      'cta'
    ]);
  });
});

describe('hooks and trusted server calls (finding 19, fixed by spec 040)', () => {
  /**
   * Both calls are anonymous — no `user` either way. The only difference is `overrideAccess`, which
   * hooks could not see until spec 040: the clinic taking a booking over the phone kept being
   * downgraded to `pending` by the rule that exists to stop visitors self-confirming.
   */
  it('lets the clinic write its own booking straight to confirmed', async () => {
    const trusted = await cms.create({
      collection: 'bookings',
      data: {
        name: 'Front desk phone booking',
        email: 'phone@example.com',
        preferredDate: new Date().toISOString(),
        status: 'confirmed'
      }
    });

    expect(trusted.status).toBe('confirmed');
  });

  it('still forces a visitor’s booking to pending', async () => {
    const fromTheStreet = await cms.create({
      collection: 'bookings',
      ...AS_VISITOR,
      data: {
        name: 'Walk-in',
        email: 'walkin@example.com',
        preferredDate: new Date().toISOString()
      }
    });

    expect(fromTheStreet.status).toBe('pending');
  });
});

describe('slugs and defaults come from the schema (finding 1, fixed by spec 040)', () => {
  it('generates a slug with no hook in the collection definition', async () => {
    const created = await cms.create({
      collection: 'services',
      data: {
        name: 'Láser facial — sesión completa',
        summary: 'Checks that autoGenerate does the work.',
        durationMinutes: 45,
        price: 80
      }
    });

    expect(created.slug).toBe('laser-facial-sesion-completa');
  });

  it('applies defaultValue without a hook', async () => {
    const created = await cms.create({
      collection: 'bookings',
      data: {
        name: 'Default check',
        email: 'defaults@example.com',
        preferredDate: new Date().toISOString()
      }
    });

    expect(created.source).toBe('website');
  });
});

describe('uploads are populated by depth (finding 9, fixed by spec 040)', () => {
  it('returns the media document for a service image', async () => {
    const { docs } = await cms.find({
      collection: 'services',
      where: { slug: 'signature-hydraglow-facial' },
      limit: 1,
      depth: 1,
      ...AS_VISITOR
    });

    const image = docs[0]?.image as Record<string, unknown>;
    expect(image.url).toBe('/images/signature-facial.svg');
  });
});
