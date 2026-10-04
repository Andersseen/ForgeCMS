---
title: Angular client
description: provideForgeCms, the typed and untyped CmsApiService, query options and signal-based resources.
group: Client & deploy
order: 1
---

`@forge-cms/angular` is the browser-side client: a `fetch`-based service (zero runtime
dependencies), signal-based resources over it, and typed errors.

## Setup

```ts
// app.config.ts
import { provideForgeCms } from '@forge-cms/angular';

export const appConfig: ApplicationConfig = {
  providers: [provideForgeCms()] // same-origin /api/v1 and /api/auth, cookie session
};
```

`provideForgeCms()` with no options is a complete same-origin setup. Every option is optional:

| Option           | Default       | Meaning                                                               |
| ---------------- | ------------- | --------------------------------------------------------------------- |
| `baseUrl`        | `'/api/v1'`   | Content API: collections, documents, globals, preview                 |
| `authBaseUrl`    | `'/api/auth'` | `login`, `signup`, `logout`, `me`, `users*`                           |
| `credentials`    | `'include'`   | Browser cookies for credential targets; `'omit'` for Bearer-only apps |
| `authToken`      | none          | `Authorization: Bearer …` (string, or function re-read per request)   |
| `trustedOrigins` | `[]`          | Other origins allowed to receive cookies and the Bearer token         |
| `transport`      | native fetch  | `(request) => Promise<Response>` — tests, and later SSR               |

**URLs.** A relative base (`/cms/api`) resolves against the page's origin; an absolute one
(`https://cms.example.com/api`) is used as given. A trailing slash is ignored, and every collection
slug, document id, user id and global slug is encoded as one path segment
(`getDocument('posts', 'a/b c')` → `/api/v1/posts/a%2Fb%20c`). Empty, `.` and `..` ids are refused.

**Credentials.** Cookies and the Bearer token go only to _credential targets_: relative URLs, the
page's own origin, and origins listed in `trustedOrigins`. Any other absolute origin receives a
request with `credentials: 'omit'` and no `Authorization` header — a token is never forwarded to an
origin you did not name. A cross-origin setup also needs the server to allow it (CORS with
credentials). `login`/`signup`/`logout` never attach the Bearer token.

```ts
provideForgeCms({
  baseUrl: 'https://cms.example.com/content-api',
  authBaseUrl: 'https://cms.example.com/account-api',
  trustedOrigins: ['https://cms.example.com']
});
```

Use `authToken` only for **machine/API-key clients**; a browser app uses the cookie session of
[the reusable auth UI](/docs/browser-auth).

**No retries.** Each method sends exactly one request. A failed `POST`/`PUT`/`DELETE`, upload, login,
signup or logout is never retried: a lost connection leaves the server-side outcome unknown. Every
method takes a last `{ signal }` argument; aborting rejects with `kind: 'aborted'`.

## `CmsApiService`

```ts
import { CmsApiService } from '@forge-cms/angular';

const cms = inject(CmsApiService); // untyped: any slug, UntypedDocument results
```

`inject(CmsApiService)` is the **untyped** client — the right choice for code that discovers
collections at runtime (the admin UI does). For application code, bind it to your content model with
[`injectForgeClient<Schema>()`](#typed-client-schema-aware): same instance, same configuration, checked
types.

| Method                                                    | Returns (untyped / typed)                          |
| --------------------------------------------------------- | -------------------------------------------------- |
| `getDocuments(collection, options?)`                      | documents — just the docs                          |
| `listDocuments(collection, options?)`                     | `{ docs, meta }` — with pagination                 |
| `getDocument(collection, id, { depth?, locale? })`        | one document                                       |
| `findOne(collection, where?, options?)`                   | document `\| null` — first match, via `limit: 1`   |
| `createDocument(collection, data, { locale? })`           | the document, or `{ id }` when you may not read it |
| `updateDocument(collection, id, data, { locale? })`       | the document, or `{ id }` when you may not read it |
| `setDocumentStatus(collection, id, status)`               | as `updateDocument` (drafts collections)           |
| `deleteDocument(collection, id)`                          | `void`                                             |
| `uploadFile(collection, file, fields?)`                   | multipart create, as `createDocument`              |
| `getGlobal(slug)` / `updateGlobal(slug, data)`            | global document `\| null` / write result           |
| `getCollections()`                                        | `CollectionMeta[]` — schema metadata               |
| `login(email, password)` / `signup(input)` / `logout()`   | `{ token, user }` / `void` — see below             |
| `getCurrentUser()`                                        | `AuthUser \| null`                                 |
| `getUsers()` / `createUser` / `updateUser` / `deleteUser` | user management (admin)                            |

Untyped results are `UntypedDocument` (`{ id: string; [field: string]: unknown }`) and payloads are
`Record<string, unknown>`.

Bearer/`authToken` requests send the token on **reads as well as writes**, which is what makes drafts
and field-level read rules work for a signed-in editor over that path.

`login`/`signup`/`logout` are the low-level primitives — they exist so `ForgeAuthSession` (below) can
be built on `CmsApiService` alone, with zero extra dependencies. A real app should use
`ForgeAuthSession`, not these three directly; see [Browser auth](/docs/browser-auth).

## Typed client (schema-aware)

Define the content model once on the server and share only its **type** with the browser. No code
generation: `import type` is erased from the compiled JavaScript, so hooks, access functions, adapters
and secrets never reach the bundle.

```ts
// src/server/content.ts — server code (hooks, access rules, …)
export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  locales: ['en', 'es'],
  fields: {
    title: defineField.text({ required: true, localized: true }),
    slug: defineField.slug({ required: true, autoGenerate: true, sourceField: 'title' }),
    publishedAt: defineField.date(),
    author: defineField.relation({ collection: 'users', required: true }),
    internalNote: defineField.textarea({ access: { read: ['admin'] } })
  },
  hooks: { beforeChange: [stampEditor] }
});
export const users = defineUsersCollection();
export const collections = [users, posts];
export const siteSettings = defineGlobal({ slug: 'site', fields: { name: defineField.text() } });
```

```ts
// src/app/forge-schema.ts — browser code, types only
import type { ForgeSchema } from '@forge-cms/angular';
import type { collections, siteSettings } from '../server/content';

export type SiteSchema = ForgeSchema<typeof collections, [typeof siteSettings]>;
```

```ts
// app.config.ts: provideForgeCms() as above. Then, in any component or service:
import { injectForgeClient } from '@forge-cms/angular';
import type { SiteSchema } from './forge-schema';

export class JournalPage {
  private readonly cms = injectForgeClient<SiteSchema>();

  async load() {
    // Typed query: unknown slugs and fields do not compile.
    const { docs } = await this.cms.listDocuments('posts', {
      where: { _status: 'published' },
      sort: [{ field: 'publishedAt', order: 'desc' }],
      depth: 1,
      locale: 'es'
    });
    docs[0]?.title; // string (resolved to 'es')
    docs[0]?.publishedAt; // string | null | undefined — an ISO string, not a Date
    docs[0]?.author; // populated user document | null

    // Typed create: `title` and `author` are required, `slug` is generated, `id` is refused.
    const created = await this.cms.createDocument(
      'posts',
      { title: 'Hola', author: 'user-1', publishedAt: new Date() },
      { locale: 'es' }
    );
    // Typed update: any subset; a value of the wrong type does not compile.
    await this.cms.updateDocument('posts', created.id, { _status: 'published' });
  }
}
```

Every slug needs to be a literal: one collection typed with slug `string` makes every slug valid.
`defineUsersCollection()` keeps its `'users'` slug; inline `withAuthFields(defineCollection({ … }))`
widens it, so define the collection first and wrap it second.

### What the types promise

The types describe the JSON the server sends, which is not the same as the server-side value:

| In the schema                            | In a read (`ForgeDocument`)                                            |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `id`, `created_at`, `updated_at`         | always present (`string`); `_status` too on `drafts: true` collections |
| `required: true`                         | present                                                                |
| not required                             | optional and nullable — absent on in-memory, `null` on SQL             |
| `access: { read: … }` (any rule)         | optional: the server omits the field for callers the rule denies       |
| `access: { read: [] }`                   | not in the type (never sent, e.g. `passwordHash`)                      |
| `date`                                   | `string` (ISO-8601, `toISOString()` form)                              |
| `relation` / `upload` at `depth: 0`      | the id (`string`), or `string[]` for `many: true`                      |
| `relation` / `upload` at `depth: 1`      | target document **or `null`** (missing, unreadable, a hidden draft)    |
| `relation({ many: true })` at `depth: 1` | array of the readable targets (others are dropped)                     |
| `localized: true` without `locale`       | `Record<string, string>` — one value per locale                        |
| `localized: true` with `locale`          | `string`, resolved with fallback                                       |
| `select({ options: ['a', 'b'] })`        | `'a' \| 'b'`                                                           |

A populated target is the target's own depth-0 projection (not populated further; its localized fields
stay per-locale maps) and is filtered by its own read rules.

**Writes.** `ForgeCreateInput` requires exactly the fields Forge requires from the caller — `required`
fields without a `defaultValue` that are not auto-generated slugs — and refuses `id`, timestamps and
fields nobody may write. `ForgeUpdateInput` makes everything optional; only non-required fields accept
`null`. A date input is `Date | string` (a `Date` is sent as its ISO string). With `{ locale }` a
localized field takes a plain string; without it, a per-locale map.

**Write results.** A create or update answers with the document, or only `{ id }` when the writer may
not read it back (a public form posting to a staff-only collection). Narrow with
`if ('created_at' in result) …`.

**Globals.** `getGlobal` reads at depth 0 without a locale (localized fields are maps);
`updateGlobal` takes a partial body.

**Limits.** Responses are not validated at runtime: the types are as true as the schema type you
share. `afterRead` hooks that reshape documents are not visible to the types — read such a collection
with the untyped client. `where` values stay loosely typed (field names are checked); the server
validates them. `blocks` rows are `{ blockType: string; [field: string]: unknown }`.

### Typed resources

```ts
protected readonly posts = collectionResource<SiteSchema, 'posts', 1>(() => ({
  collection: 'posts',
  depth: 1,
  limit: this.pageSize()
}));
```

Pass the schema and the slug (plus a `depth`/`locale` literal when you use one). Without type
arguments a resource stays untyped.

### Migrating from the `<T>` pattern (C02)

The per-method response generic is gone: `getDocument<Post>('posts', id)` no longer compiles, because
it let a caller assert any shape.

- Typed code: `injectForgeClient<SiteSchema>().getDocument('posts', id)` — the result is derived from
  the schema. View models built server-side (a `/api/site/*` payload) keep their own hand-written
  types; they are not raw CMS documents.
- Dynamic code: keep `inject(CmsApiService)`; results are `UntypedDocument`.
- `collectionResource<Post>(…)` → `collectionResource<SiteSchema, 'posts'>(…)`, or no type argument.
- Typed create/update results are `document | { id }` (see above).
- Date fields are ISO strings in every response — they always were on the wire; the Local API now
  returns them as strings too instead of a `Date` on libSQL/D1.

## Query options

`QueryOptions` mirrors what the API parses:

```ts
const { docs, meta } = await cms.listDocuments('products', {
  where: {
    category: 'facial', // equality
    price: { gte: 50, lte: 200 }, // operators
    id: { in: ['a', 'b'] },
    name: { contains: 'laser' }
  },
  sort: 'price',
  order: 'desc',
  limit: 12,
  page: 2, // converted to offset when limit is set
  depth: 1,
  status: 'published'
});
```

`buildQueryString(options)` is exported too — use it when you build links yourself (a paginator
writing `?page=2`, a filter chip) so the strings match exactly.

### Nested `where` and multi-field `sort`

`where` also accepts nested `and`/`or` groups, and `sort` accepts a `{ field, order }[]` — both
serialize through the same `buildQueryString` helper every method above already uses, so nothing else
changes:

```ts
const { docs } = await cms.listDocuments('posts', {
  where: {
    and: [{ status: 'published' }, { or: [{ featured: true }, { views: { gte: 1000 } }] }]
  },
  sort: [
    { field: 'featured', order: 'desc' },
    { field: 'created_at', order: 'desc' }
  ]
});

const post = await cms.findOne('posts', { slug: 'hello-world' });
```

## Signal-based resources

The idiomatic way to read in a component. The resource re-runs whenever the params signal changes,
cancels the request it supersedes, and stays idle while params return `undefined`:

```ts
import { Component, computed, inject, input, signal } from '@angular/core';
import { collectionResource, documentResource } from '@forge-cms/angular';

@Component({
  selector: 'app-products',
  template: `
    @if (products.isLoading()) {
      <p>Loading…</p>
    } @else if (products.error(); as error) {
      <p>{{ error.message }}</p>
    } @else {
      @for (product of products.value()?.docs ?? []; track product['id']) {
        <article>{{ product['name'] }}</article>
      }
      <button [disabled]="!products.value()?.meta?.hasNextPage" (click)="page.set(page() + 1)">
        Next
      </button>
    }
  `
})
export class ProductsComponent {
  readonly category = input<string>('');
  protected readonly page = signal(1);

  protected readonly products = collectionResource(() => ({
    collection: 'products',
    where: { category: this.category() },
    limit: 12,
    page: this.page()
  }));
}
```

One document, e.g. from a route param:

```ts
protected readonly product = documentResource(() => {
  const id = this.id();
  return id ? { collection: 'products', id, depth: 1 } : undefined;
});
```

Every resource exposes `value()`, `isLoading()`, `error()` and `reload()`.

### Resource contract

A resource sends at most one request at a time and never retries. `value()` is `undefined` or the
result of **the current request under the current credentials** — never a previous query, never
another user's data. `value()` and `error()` are never both set. Two requests are "the same" when they
produce the same URL (a `page` without `limit`, for example, is not sent and does not change it).

| What happens                              | `value()`                 | `isLoading()` | `error()`           |
| ----------------------------------------- | ------------------------- | ------------- | ------------------- |
| Params return `undefined` (idle)          | `undefined`               | `false`       | `null`              |
| First request / a different request       | `undefined`               | `true`        | `null`              |
| Success                                   | the result                | `false`       | `null`              |
| Failure (HTTP, network, invalid response) | `undefined`               | `false`       | the `ForgeApiError` |
| `reload()`, or the same request rebuilt   | kept until the new result | `true`        | `null`              |
| Sign-in, sign-out, session expiry         | `undefined` immediately   | `true`        | `null`              |
| The owning component is destroyed         | frozen                    | frozen        | frozen              |

- **Cancellation.** Each request gets its own `AbortSignal` (passed to your `transport` too). It is
  aborted when params change, on `reload()`, when params become `undefined`, on a credential change,
  and when the component (injection context) that created the resource is destroyed. A cancelled
  request never becomes an `error()`. Even a custom transport that ignores the signal cannot
  overwrite newer state: only the current request may write the signals.
- **`reload()`** cancels the active request and runs the current params once (several calls before
  Angular re-runs the resource collapse into one); it does nothing while idle.
- **Credentials.** `ForgeAuthSession` marks every identity change it makes — successful login or
  signup, every logout (even a failed one), the first `401` while signed in, a refresh that finds
  another user — and every resource immediately hides its value and reloads under the new identity.
  A request started as user A can never fill a resource after the switch to user B. The first `/me`
  check on page load is not a change. With `authToken`, a function that reads a **signal** is
  observed the same way (`authToken: () => this.token()`); a function reading non-reactive storage
  is re-read per request but cannot trigger a reload. A static API key never changes identity.
- **Errors** are the same `ForgeApiError` instance the service threw (`kind`, `status`, `code`,
  `details`).

## Errors

Every failure is a `ForgeApiError`: `kind` says what happened, `status` and the server's Forge
`code`/`details` are kept. `ApiValidationError`, `ApiAuthError` and `ApiAuthActionError` are
subclasses, so existing `instanceof` checks still work.

| Scenario                     | `kind`             | `status`  | `code` (example)            | Class                | Session effect          |
| ---------------------------- | ------------------ | --------- | --------------------------- | -------------------- | ----------------------- |
| 400 with field errors        | `http`             | 400       | `VALIDATION_ERROR`          | `ApiValidationError` | none                    |
| 401                          | `http`             | 401       | `UNAUTHORIZED`              | `ApiAuthError`       | signed-in → `anonymous` |
| 403                          | `http`             | 403       | `FORBIDDEN`                 | `ForgeApiError`      | none — still signed in  |
| 404 / 409 / 413 / 429 / 500  | `http`             | as sent   | server code, `details` kept | `ForgeApiError`      | none                    |
| Non-JSON error page (proxy)  | `http`             | as sent   | `HTTP_ERROR` (body dropped) | `ForgeApiError`      | none                    |
| 2xx that is not valid JSON   | `invalid-response` | as sent   | `INVALID_RESPONSE`          | `ForgeApiError`      | none                    |
| Offline / DNS / CORS refused | `network`          | undefined | `NETWORK_ERROR`             | `ForgeApiError`      | none                    |
| `AbortSignal` fired          | `aborted`          | undefined | `ABORTED`                   | `ForgeApiError`      | none                    |
| Login/signup/logout HTTP     | `http`             | as sent   | server code                 | `ApiAuthActionError` | see below               |

```ts
import { ApiValidationError, ForgeApiError, isForgeApiError } from '@forge-cms/angular';

try {
  await cms.createDocument('bookings', form);
} catch (err) {
  if (err instanceof ApiValidationError) {
    // err.details → [{ field: 'email', message: '…', code: 'type_email' }]
  } else if (err instanceof ForgeApiError && err.status === 409) {
    // err.code === 'UNIQUE_CONSTRAINT', err.details → which value conflicted
  } else if (isForgeApiError(err, 'network')) {
    // no response: show "offline", keep the form
  }
}
```

A non-JSON body is never copied into the error. For readable UI copy, `@forge-cms/admin` exports
`describeAdminError(err)` and `describeSessionError(err)`.

### Session semantics

`ForgeAuthSession` bootstraps from `GET {authBaseUrl}/me`:

- `401` → `status() === 'anonymous'`, `error() === null`.
- `200` → `'authenticated'`.
- `403`, `5xx`, network failure or a malformed response → `'error'`, with the `ForgeApiError` in
  `error()`. An outage is not presented as "signed out"; `forgeAuthGuard` still denies access.

`logout()` always clears the local user (`status() === 'anonymous'`). If the request failed,
`error()` keeps the `ForgeApiError`: the server session or its cookie may still exist, so do not tell
the user they signed out cleanly.

### Migrating from 0.8.x

Nothing is required: defaults and method signatures are unchanged, and every method gained only an
optional last `{ signal }` argument.

- `baseUrl` is now optional (was required); `provideForgeCms()` works with no argument.
- `getCurrentUser()` used to resolve `null` for **any** failure. It now resolves `null` only for a 401
  and throws `ForgeApiError` for a 403, 5xx, network failure or malformed response.
- A failed `ForgeAuthSession.logout()` used to clear `error()`; it now keeps the failure.
- Other failures used to be a plain `Error` whose message ended in `: <status>`; they are now
  `ForgeApiError` with `status`/`code`/`details` (the message is unchanged when the server sent none).
- An absolute `baseUrl`/`authBaseUrl` on another origin no longer receives cookies or the Bearer
  token unless its origin is listed in `trustedOrigins`.

## Role helpers

Re-exported so the UI can hide what the backend would refuse anyway — they are convenience, not
security:

```ts
import { canManageUsers, canWriteContent, isAdmin, userRole } from '@forge-cms/angular';
```

## Compatibility

Peer ranges are the versions proven by `pnpm release:compat`: external Vite +
`@analogjs/vite-plugin-angular` apps installed only from the packed tarballs with
`strict-peer-dependencies=true` and `auto-install-peers=false`, each checked for a single Angular
copy, `tsc` + `ngc` with `strictTemplates`, and a fully linked production build.

| Package              | Angular                | Other peers                                                                                                                   |
| -------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `@forge-cms/angular` | `^21.0.0 \|\| ^22.0.0` | optional, for `/vite`: `@angular/compiler-cli` (same as Angular), `@babel/core` `^7.28.0 \|\| ^8.0.0`, `vite` `^7 \|\| ^8`    |
| `@forge-cms/admin`   | `^21.2.0`              | `rxjs` `^7.8.0`, `@voltui/components` `^1.0.1`, `lumen-icons` `^0.2.0`; optional `@babel/core` `^7.28.0`, `vite` `^7 \|\| ^8` |

Tested combinations (2026-10-04):

| Combination   | Packages        | Angular | `@angular/build` | TypeScript | rxjs  | Vite  | vite-plugin-angular | Babel  | VoltUI |
| ------------- | --------------- | ------- | ---------------- | ---------- | ----- | ----- | ------------------- | ------ | ------ |
| `angular-min` | angular         | 21.0.0  | 21.0.0           | 5.9.2      | 7.8.0 | 7.0.0 | 2.4.8               | 7.28.0 | —      |
| `admin-min`   | angular + admin | 21.2.0  | 21.2.0           | 5.9.2      | 7.8.0 | 7.0.0 | 2.4.8               | 7.28.0 | 1.0.1  |
| `current`     | angular + admin | 21.2.10 | 21.2.10          | 5.9.2      | 7.8.2 | 7.1.4 | 2.4.8               | 7.29.0 | 1.1.0  |
| `latest-21`   | angular + admin | 21.2.25 | 21.2.24          | 5.9.3      | 7.8.2 | 8.3.2 | 2.8.0               | 7.29.7 | 1.1.0  |
| `angular-22`  | angular         | 22.2.1  | 22.2.1           | 6.0.3      | 7.8.2 | 8.3.2 | 2.8.0               | 8.0.6  | —      |

- `@forge-cms/admin` stops at Angular 21 because its UI library, VoltUI 1.x, peers
  `@angular/* ^21.2.0`; VoltUI's own dependency also needs `@angular/cdk` installed by the app.
- Angular 22's linker requires Babel 8; Angular 21 was tested with Babel 7.
- Angular 19/20 are not supported.
- **Vite/Analog apps need the linker** — for `@forge-cms/angular` alone too. Forge's packages are
  partial-Ivy `ngc` output, which Analog does not link (it only links `fesm2022` packages); without
  it a production build crashes with `JIT compiler unavailable`. The Angular CLI links them itself.

```ts
// vite.config.ts
import { angularLinker } from '@forge-cms/angular/vite'; // `@forge-cms/admin/vite` is the same plugin

export default defineConfig({ plugins: [angularLinker(), analog()] });
```

## Limits

- **No SSR-safe fetch or transfer state.** The base URL is relative and the service is browser-first.
  For a content site that needs SSR, call the [Local API](/docs/local-api) from a server route and
  hand the page a purpose-built payload — better for payload size anyway.
- **Documents are `UntypedDocument` on the untyped client.** Use
  [`injectForgeClient<Schema>()`](#typed-client-schema-aware) for schema-derived types.
- No caching, normalised store or retries — a failed read stays failed until `reload()`.
