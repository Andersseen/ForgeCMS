/**
 * Content-model tests, driven through the Local API against a real in-memory runtime.
 *
 * They live in `src/tests/` rather than next to the code they cover (the repo's usual colocation
 * rule): Nitro bundles **everything** under `src/server/**` into the worker, so a `*.test.ts` there
 * pulls `vitest` into the server bundle and the API crashes on the first request.
 */
import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { AccessDeniedError, NotFoundError, ValidationFailedError } from '@forge-cms/runtime';
import type { CmsUser } from '@forge-cms/core';
import { createRuntime, type DemoRuntime } from '../server/api/runtime';
import { seedContent } from '../server/api/seed';
import { loadServiceDetail } from '../server/api/service-detail';
import { toPostSummary } from '../server/api/mappers';

const STAFF: CmsUser = { id: 'staff-1', email: 'frontdesk@lumea.clinic', role: 'editor' };
const CLIENT: CmsUser = { id: 'client-1', email: 'lucia@example.com', role: 'viewer' };

/** How the public site reads: as nobody, with access control on. */
const AS_VISITOR = { overrideAccess: false, user: null } as const;

let cms: DemoRuntime;

beforeEach(async () => {
  cms = createRuntime(undefined, { devMode: true });
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
        preferredDate: new Date()
      }
    });

    // A visitor may create a booking but not read one back (spec 068): the response is its id only.
    expect(booking).toEqual({ id: expect.any(String) });
    const stored = await cms.findByID({ collection: 'bookings', id: booking.id as string });
    // beforeValidate normalises the address the visitor typed.
    expect(stored.email).toBe('nora@example.com');
  });

  it('forces a public create to land as pending, whatever the body says', async () => {
    const booking = await cms.create({
      collection: 'bookings',
      ...AS_VISITOR,
      data: {
        name: 'Optimistic visitor',
        email: 'optimist@example.com',
        preferredDate: new Date(),
        // `status` is staff-write-only, so the hook — not the body — decides.
        source: 'crafted'
      }
    });

    const stored = await cms.findByID({ collection: 'bookings', id: booking.id as string });
    expect(stored.status).toBe('pending');
  });

  it('rejects a public create that tries to set a staff-only field', async () => {
    await expect(
      cms.create({
        collection: 'bookings',
        ...AS_VISITOR,
        data: {
          name: 'Sneaky visitor',
          email: 'sneaky@example.com',
          preferredDate: new Date(),
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
        preferredDate: new Date(),
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
        preferredDate: new Date()
      }
    });

    const stored = await cms.findByID({ collection: 'bookings', id: fromTheStreet.id as string });
    expect(stored.status).toBe('pending');
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
        preferredDate: new Date()
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

    // The typed Local API still types a relation/upload as its id, populated or not (see finding 8's
    // remaining limit), so a populated value needs one explicit widening.
    const image = docs[0]?.image as unknown as Record<string, unknown>;
    expect(image.url).toBe('/images/signature-facial.svg');
  });
});

describe('service detail reads (finding 10, migrated to findOne + containsValue)', () => {
  it('finds specialists in the database exactly as the old load-everything filter did', async () => {
    const detail = await loadServiceDetail(cms, 'signature-hydraglow-facial');
    expect(detail).not.toBeNull();
    const serviceId = detail!.service.id;

    // The replaced workaround: load the whole active team, keep whoever lists this service.
    const team = await cms.find({
      collection: 'staff',
      where: { active: true },
      limit: 100,
      ...AS_VISITOR
    });
    const expected = team.docs
      .filter(
        (member) => Array.isArray(member.specialties) && member.specialties.includes(serviceId)
      )
      .map((member) => member.id)
      .sort();

    expect(expected.length).toBeGreaterThan(0);
    expect(detail!.specialists.map((member) => member.id).sort()).toEqual(expected);
    // Populated: specialties are names and the photo is a media reference, not ids.
    expect(detail!.specialists.every((member) => member.photo?.url.startsWith('/'))).toBe(true);
  });

  it('lists up to three siblings from the same category, never the service itself', async () => {
    const detail = await loadServiceDetail(cms, 'signature-hydraglow-facial');
    const { relatedServices, service } = detail!;

    expect(relatedServices.length).toBeGreaterThan(0);
    expect(relatedServices.length).toBeLessThanOrEqual(3);
    expect(relatedServices.some((related) => related.id === service.id)).toBe(false);
    expect(relatedServices.every((related) => related.category?.id === service.category?.id)).toBe(
      true
    );
  });

  it('is null for an unknown slug and for a draft, so the route answers 404', async () => {
    expect(await loadServiceDetail(cms, 'no-such-treatment')).toBeNull();
    // The seeded draft exists for server code but not for a visitor.
    expect(
      await cms.findOne({ collection: 'services', where: { slug: 'bridal-glow-programme' } })
    ).not.toBeNull();
    expect(await loadServiceDetail(cms, 'bridal-glow-programme')).toBeNull();
  });
});

describe('the typed Local API (finding 8, spec 047)', () => {
  it('infers documents from the registry instead of Record<string, unknown>', async () => {
    const service = await cms.findOne({ collection: 'services', where: { slug: 'x' } });
    expectTypeOf(service).toMatchTypeOf<{ name: string; price: number; id: string } | null>();

    // Compile-time only: never called, so the invalid queries are checked by `tsc`, not executed.
    const rejectedAtCompileTime = (): void => {
      // @ts-expect-error — not a collection in this app's registry.
      void cms.find({ collection: 'not-a-collection' });
      // @ts-expect-error — not a field of `services`.
      void cms.find({ collection: 'services', where: { priceInCents: 100 } });
    };
    expect(rejectedAtCompileTime).toBeTypeOf('function');
  });

  it('maps a SQL-style Date read to the same ISO string as a string read (finding 24)', async () => {
    const post = await cms.findOne({
      collection: 'posts',
      where: { title: 'The only two products your morning routine actually needs' }
    });
    expect(post).not.toBeNull();
    const asString = toPostSummary(post!);
    const asDate = toPostSummary({ ...post!, publishedAt: new Date(asString.publishedAt) });

    expect(asString.publishedAt).not.toBe('');
    expect(asDate.publishedAt).toBe(new Date(asString.publishedAt).toISOString());
  });
});
