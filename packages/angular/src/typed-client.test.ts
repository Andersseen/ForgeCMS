/**
 * Spec 076 (roadmap C02): the schema-aware client.
 *
 * The `expectTypeOf` assertions and every `@ts-expect-error` line are checked by
 * `pnpm --filter @forge-cms/angular typecheck` (`tsconfig.json` includes `*.test.ts`). The compile-only
 * functions are declared and never invoked, so a removed `@ts-expect-error` fails the typecheck, not a
 * test. The runtime tests at the end prove the typed client is the same instance sending the same
 * requests. Real-HTTP evidence that these types match the server lives in
 * `apps/tiny-project/src/tests/wire-types.integration.test.ts`.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { defineCollection, defineField, defineGlobal } from '@forge-cms/core';
import type { RichTextContent } from '@forge-cms/core';
import { CmsApiService, injectForgeClient } from './api.service.js';
import { collectionResource, documentResource } from './resources.js';
import { FORGE_CMS_CONFIG } from './types.js';
import type { ForgeTransportRequest } from './types.js';
import type {
  ForgeCreateInput,
  ForgeDocument,
  ForgeGlobalDocument,
  ForgeLocalizedValue,
  ForgeSchema,
  ForgeUpdateInput,
  ForgeWriteReceipt,
  UntypedDocument
} from './schema.js';

// --- a content model, as a server would declare it ------------------------------------------------

export const users = defineCollection({
  slug: 'users',
  fields: {
    email: defineField.email({ required: true }),
    name: defineField.text(),
    role: defineField.select({ options: ['admin', 'editor'], defaultValue: 'editor' }),
    passwordHash: defineField.text({ access: { read: [], write: [] } })
  },
  access: { read: ({ user }) => user !== null }
});

export const media = defineCollection({
  slug: 'media',
  upload: true,
  fields: { filename: defineField.text({ required: true }), alt: defineField.text() }
});

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  locales: ['en', 'es'],
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({ required: true, autoGenerate: true, sourceField: 'title' }),
    headline: defineField.text({ required: true, localized: true }),
    publishedAt: defineField.date(),
    views: defineField.number({ defaultValue: 0 }),
    author: defineField.relation({ collection: 'users', required: true }),
    related: defineField.relation({ collection: 'posts', many: true }),
    cover: defineField.upload({ collection: 'media' }),
    category: defineField.select({ options: ['news', 'guide'] }),
    internalNote: defineField.textarea({ access: { read: ['admin'] } }),
    body: defineField.richtext(),
    seo: defineField.group({
      fields: { metaTitle: defineField.text({ required: true }), noIndex: defineField.boolean() }
    })
  },
  hooks: { beforeChange: [({ data }) => data] }
});

export const settings = defineGlobal({
  slug: 'settings',
  fields: { siteName: defineField.text({ required: true }), launchAt: defineField.date() }
});

export const guarded = defineCollection({
  slug: 'guarded',
  fields: { secret: defineField.text({ required: true, access: { read: ['admin'] } }) }
});

/** What a browser module declares — in an app, from `import type` of the server's definitions. */
type Site = ForgeSchema<[typeof users, typeof media, typeof posts], [typeof settings]>;

type User = ForgeDocument<Site, 'users'>;
type Post = ForgeDocument<Site, 'posts'>;
type Media = ForgeDocument<Site, 'media'>;

// --- read projections ------------------------------------------------------------------------------

describe('read projection (compile time)', () => {
  it('types system fields, required, optional and nullable fields', () => {
    expectTypeOf<Post['id']>().toEqualTypeOf<string>();
    expectTypeOf<Post['created_at']>().toEqualTypeOf<string>();
    expectTypeOf<Post['_status']>().toEqualTypeOf<'draft' | 'published'>();
    expectTypeOf<Post['title']>().toEqualTypeOf<string>();
    expectTypeOf<Post>().toHaveProperty('views');
    expectTypeOf<Post['views']>().toEqualTypeOf<number | null | undefined>();
    expectTypeOf<Post['category']>().toEqualTypeOf<'news' | 'guide' | null | undefined>();
    expectTypeOf<Post['body']>().toEqualTypeOf<RichTextContent | null | undefined>();
    expectTypeOf<Post['seo']>().toEqualTypeOf<
      { metaTitle: string; noIndex?: boolean | null } | null | undefined
    >();
    // A collection without drafts has no `_status`.
    expectTypeOf<Media>().not.toHaveProperty('_status');
  });

  it('reads a date as a string, never a Date', () => {
    expectTypeOf<Post['publishedAt']>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<ForgeGlobalDocument<Site, 'settings'>['launchAt']>().toEqualTypeOf<
      string | null | undefined
    >();
  });

  it('does not guarantee access-controlled fields and drops never-readable ones', () => {
    expectTypeOf<Post>().toHaveProperty('internalNote');
    expectTypeOf<Post['internalNote']>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<User>().not.toHaveProperty('passwordHash');
    // Required but access-controlled: optional, never null.
    type Guarded = ForgeDocument<ForgeSchema<[typeof guarded]>, 'guarded'>;
    expectTypeOf<Guarded['secret']>().toEqualTypeOf<string | undefined>();
  });

  it('types relations and uploads as ids at depth 0', () => {
    expectTypeOf<Post['author']>().toEqualTypeOf<string>();
    expectTypeOf<Post['related']>().toEqualTypeOf<string[] | null | undefined>();
    expectTypeOf<Post['cover']>().toEqualTypeOf<string | null | undefined>();
  });

  it('types depth-1 targets as readable documents or null, many as an array', () => {
    type Populated = ForgeDocument<Site, 'posts', 1>;
    expectTypeOf<Populated['author']>().toEqualTypeOf<User | null>();
    expectTypeOf<Populated['cover']>().toEqualTypeOf<Media | null | undefined>();
    expectTypeOf<Populated['related']>().toEqualTypeOf<Post[] | null | undefined>();
    // A populated target is not populated further.
    expectTypeOf<NonNullable<Populated['related']>[number]['author']>().toEqualTypeOf<string>();
  });

  it('types localized fields by locale mode', () => {
    expectTypeOf<Post['headline']>().toEqualTypeOf<ForgeLocalizedValue>();
    expectTypeOf<ForgeDocument<Site, 'posts', 0, 'es'>['headline']>().toEqualTypeOf<string>();
    expectTypeOf<ForgeDocument<Site, 'posts', 0, string>['headline']>().toEqualTypeOf<string>();
    expectTypeOf<ForgeDocument<Site, 'posts', 0, string | undefined>['headline']>().toEqualTypeOf<
      string | ForgeLocalizedValue
    >();
    // A populated target keeps per-locale maps even when the parent was read with a locale.
    expectTypeOf<
      NonNullable<ForgeDocument<Site, 'posts', 1, 'es'>['related']>[number]['headline']
    >().toEqualTypeOf<ForgeLocalizedValue>();
  });
});

// --- write projections -----------------------------------------------------------------------------

describe('create and update inputs (compile time)', () => {
  it('requires what Forge requires and omits what it generates', () => {
    type CreatePost = ForgeCreateInput<Site, 'posts'>;
    const minimal: CreatePost = {
      title: 'Hello',
      headline: { en: 'Hello' },
      author: 'user-1'
    };
    const full: CreatePost = {
      title: 'Hello',
      slug: 'hello',
      headline: { en: 'Hello', es: 'Hola' },
      publishedAt: new Date(),
      views: null,
      author: 'user-1',
      related: ['post-2'],
      cover: null,
      category: 'guide',
      seo: { metaTitle: 'Hello' },
      _status: 'published'
    };
    expectTypeOf<ForgeCreateInput<Site, 'users'>>().not.toHaveProperty('passwordHash');
    expectTypeOf<CreatePost>().not.toHaveProperty('id');
    expectTypeOf<CreatePost>().not.toHaveProperty('created_at');
    expect([minimal, full]).toHaveLength(2);
  });

  it('writes a date as a Date or a string', () => {
    expectTypeOf<ForgeCreateInput<Site, 'posts'>['publishedAt']>().toEqualTypeOf<
      Date | string | null | undefined
    >();
  });

  it('makes every update key optional and null only for non-required fields', () => {
    type UpdatePost = ForgeUpdateInput<Site, 'posts'>;
    const update: UpdatePost = { views: 2, cover: null };
    expectTypeOf<UpdatePost['title']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ForgeUpdateInput<Site, 'posts', 'es'>['headline']>().toEqualTypeOf<
      string | undefined
    >();
    expect(update).toBeDefined();
  });
});

// --- the typed client ------------------------------------------------------------------------------

/** Never invoked: valid CRUD and draft workflows compile with no `<T>` and no casts. */
async function validUsage(cms: CmsApiService<Site>): Promise<void> {
  const page = await cms.listDocuments('posts', {
    where: {
      and: [{ _status: 'published' }, { or: [{ category: 'news' }, { views: { gt: 1 } }] }]
    },
    sort: [{ field: 'publishedAt', order: 'desc' }, { field: 'created_at' }],
    limit: 10
  });
  expectTypeOf(page.docs).toEqualTypeOf<Post[]>();

  const populated = await cms.getDocument('posts', 'id-1', { depth: 1 });
  expectTypeOf(populated.author).toEqualTypeOf<User | null>();

  const spanish = await cms.getDocuments('posts', { locale: 'es' });
  expectTypeOf(spanish[0]!.headline).toEqualTypeOf<string>();

  const first = await cms.findOne('posts', { slug: 'hello' }, { depth: 1 });
  expectTypeOf(first).toEqualTypeOf<ForgeDocument<Site, 'posts', 1> | null>();

  const created = await cms.createDocument('posts', {
    title: 'Hello',
    headline: { en: 'Hello' },
    author: 'user-1'
  });
  expectTypeOf(created).toEqualTypeOf<Post | ForgeWriteReceipt>();
  if ('created_at' in created) expectTypeOf(created.title).toEqualTypeOf<string>();

  const inSpanish = await cms.createDocument(
    'posts',
    { title: 'Hola', headline: 'Hola', author: 'user-1' },
    { locale: 'es' }
  );
  expectTypeOf(inSpanish).toEqualTypeOf<
    ForgeDocument<Site, 'posts', 0, 'es'> | ForgeWriteReceipt
  >();

  await cms.updateDocument('posts', created.id, { publishedAt: new Date(), _status: 'draft' });
  await cms.setDocumentStatus('posts', created.id, 'published');
  await cms.previewDocument('posts', { title: 'Draft title' }, { id: created.id, depth: 1 });
  await cms.uploadFile('media', new File(['x'], 'x.png'), { alt: 'An image' });
  await cms.deleteDocument('posts', created.id);

  const global = await cms.getGlobal('settings');
  expectTypeOf(global).toEqualTypeOf<ForgeGlobalDocument<Site, 'settings'> | null>();
  await cms.updateGlobal('settings', { launchAt: '2026-01-01T00:00:00.000Z' });
}

/** Never invoked: each statement must fail to compile. */
async function invalidUsage(cms: CmsApiService<Site>): Promise<void> {
  // @ts-expect-error - unknown collection slug
  await cms.getDocuments('pages');
  // @ts-expect-error - unknown global slug
  await cms.getGlobal('footer');
  // @ts-expect-error - unknown where field
  await cms.getDocuments('posts', { where: { nope: 1 } });
  // @ts-expect-error - unknown field nested in an `or` group
  await cms.getDocuments('posts', { where: { or: [{ title: 'a' }, { nope: 1 }] } });
  // @ts-expect-error - unknown sort field
  await cms.getDocuments('posts', { sort: 'nope' });
  // @ts-expect-error - `_status` is not a query field of a collection without drafts
  await cms.getDocuments('media', { where: { _status: 'draft' } });
  // @ts-expect-error - a create without the required `author`
  await cms.createDocument('posts', { title: 'x', headline: { en: 'x' } });
  // @ts-expect-error - an unknown create field
  await cms.createDocument('posts', { title: 'x', headline: { en: 'x' }, author: 'u', nope: 1 });
  // @ts-expect-error - a number is not a title
  await cms.createDocument('posts', { title: 1, headline: { en: 'x' }, author: 'u' });
  // @ts-expect-error - Forge generates ids
  await cms.createDocument('media', { filename: 'a.png', id: 'mine' });
  // @ts-expect-error - a value outside the select options
  await cms.updateDocument('posts', 'id', { category: 'opinion' });
  // @ts-expect-error - a required field cannot be cleared
  await cms.updateDocument('posts', 'id', { title: null });
  // @ts-expect-error - a many relation takes an array of ids
  await cms.updateDocument('posts', 'id', { related: 'post-2' });
  // @ts-expect-error - a localized field takes a per-locale map without `locale`
  await cms.updateDocument('posts', 'id', { headline: 'Hello' });
  // @ts-expect-error - a numeric timestamp is not a typed date input
  await cms.updateDocument('posts', 'id', { publishedAt: 1_700_000_000_000 });
  // @ts-expect-error - a never-writable field
  await cms.updateDocument('users', 'id', { passwordHash: 'x' });
  // @ts-expect-error - `_status` only exists on drafts collections
  await cms.updateDocument('media', 'id', { _status: 'published' });
  // @ts-expect-error - only drafts collections have a status to set
  await cms.setDocumentStatus('media', 'id', 'published');
  // @ts-expect-error - an unknown global field
  await cms.updateGlobal('settings', { nope: true });
  // @ts-expect-error - an unknown upload field
  await cms.uploadFile('media', new File([], 'x'), { nope: 'x' });
  // @ts-expect-error - the old free response generic is gone
  await cms.getDocument<{ anything: true }>('posts', 'id');

  const post = await cms.getDocument('posts', 'id');
  // @ts-expect-error - a date is a string on the wire, not a Date
  post.publishedAt?.getTime();
  // @ts-expect-error - a depth-0 relation is an id, not a document
  void post.author.email;
  // @ts-expect-error - an access-controlled field is not guaranteed
  void post.internalNote.length;

  const populated = await cms.getDocument('posts', 'id', { depth: 1 });
  // @ts-expect-error - a populated single relation may be null (missing or inaccessible)
  void populated.author.email;

  const created = await cms.createDocument('media', { filename: 'a.png' });
  // @ts-expect-error - a write may return only a receipt; narrow before reading fields
  void created.filename;
}

/** Never invoked: the untyped escape hatch keeps every dynamic use compiling. */
async function untypedUsage(api: CmsApiService): Promise<void> {
  const slug: string = 'anything';
  const docs = await api.getDocuments(slug, { where: { whatever: true }, sort: 'any' });
  expectTypeOf(docs).toEqualTypeOf<UntypedDocument[]>();
  expectTypeOf(docs[0]!['title']).toEqualTypeOf<unknown>();
  const created = await api.createDocument(slug, { any: 'field' });
  expectTypeOf(created.id).toEqualTypeOf<string>();
  await api.setDocumentStatus(slug, created.id, 'published');
  await api.getGlobal(slug);
}

/** Never invoked: resources take the schema and the slug instead of a free `<T>`. */
function resourceUsage(): void {
  const list = collectionResource<Site, 'posts', 1>(() => ({ collection: 'posts', depth: 1 }));
  expectTypeOf(list.value()!.docs[0]!.author).toEqualTypeOf<User | null>();
  const one = documentResource<Site, 'media'>(() => ({ collection: 'media', id: 'm1' }));
  expectTypeOf(one.value()!.filename).toEqualTypeOf<string>();
  const untyped = collectionResource(() => ({ collection: 'whatever', where: { any: 1 } }));
  expectTypeOf(untyped.value()!.docs).toEqualTypeOf<UntypedDocument[]>();
  // @ts-expect-error - the request's collection must be the resource's slug
  collectionResource<Site, 'posts'>(() => ({ collection: 'media' }));
}

void validUsage;
void invalidUsage;
void untypedUsage;
void resourceUsage;

// --- runtime: the typed client is the same instance ------------------------------------------------

describe('injectForgeClient (runtime)', () => {
  it('returns the injected CmsApiService and sends the same requests', async () => {
    const requests: ForgeTransportRequest[] = [];
    const injector = Injector.create({
      providers: [
        {
          provide: FORGE_CMS_CONFIG,
          useValue: {
            transport: (request: ForgeTransportRequest) => {
              requests.push(request);
              return Promise.resolve(
                new Response(JSON.stringify({ data: { id: 'p1', title: 'T' } }), {
                  status: 200,
                  headers: { 'content-type': 'application/json' }
                })
              );
            }
          }
        },
        { provide: CmsApiService, useClass: CmsApiService, deps: [] }
      ]
    });
    const typed = runInInjectionContext(injector, () => injectForgeClient<Site>());
    const untyped = injector.get(CmsApiService);
    expect(typed).toBe(untyped);

    await typed.getDocument('posts', 'p1', { depth: 1, locale: 'es' });
    await untyped.getDocument('posts', 'p1', { depth: 1, locale: 'es' });
    await typed.createDocument(
      'posts',
      { title: 'T', headline: 'T', author: 'u' },
      { locale: 'es' }
    );
    await typed.setDocumentStatus('posts', 'p1', 'published');

    expect(requests[0]!.url).toBe('/api/v1/posts/p1?depth=1&locale=es');
    expect(requests[1]!.url).toBe(requests[0]!.url);
    expect(requests[2]).toMatchObject({ method: 'POST', url: '/api/v1/posts?locale=es' });
    expect(JSON.parse(String(requests[2]!.body))).toEqual({
      title: 'T',
      headline: 'T',
      author: 'u'
    });
    expect(requests[3]).toMatchObject({ method: 'PUT', url: '/api/v1/posts/p1' });
    expect(JSON.parse(String(requests[3]!.body))).toEqual({ _status: 'published' });
  });

  it('serialises a Date input as its ISO string', async () => {
    let body = '';
    const injector = Injector.create({
      providers: [
        {
          provide: FORGE_CMS_CONFIG,
          useValue: {
            transport: (request: ForgeTransportRequest) => {
              body = String(request.body);
              return Promise.resolve(
                new Response(JSON.stringify({ data: { id: 'p1' } }), {
                  status: 200,
                  headers: { 'content-type': 'application/json' }
                })
              );
            }
          }
        },
        { provide: CmsApiService, useClass: CmsApiService, deps: [] }
      ]
    });
    const cms = runInInjectionContext(injector, () => injectForgeClient<Site>());
    await cms.updateDocument('posts', 'p1', { publishedAt: new Date('2026-01-15T10:00:00Z') });
    expect(JSON.parse(body)).toEqual({ publishedAt: '2026-01-15T10:00:00.000Z' });
  });
});
