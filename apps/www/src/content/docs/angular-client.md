---
title: Angular client
description: provideForgeCms, CmsApiService, query options and signal-based resources.
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

const cms = inject(CmsApiService);
```

| Method                                                    | Returns                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `getDocuments(collection, options?)`                      | `T[]` — just the docs                                          |
| `listDocuments(collection, options?)`                     | `{ docs, meta }` — with pagination                             |
| `getDocument(collection, id, { depth? })`                 | `T`                                                            |
| `findOne(collection, where?, options?)`                   | `T \| null` — first match, via `limit: 1` on the list endpoint |
| `createDocument(collection, data)`                        | `T`                                                            |
| `updateDocument(collection, id, data)`                    | `T`                                                            |
| `deleteDocument(collection, id)`                          | `void`                                                         |
| `uploadFile(collection, file, fields?)`                   | `T` — multipart create                                         |
| `getCollections()`                                        | `CollectionMeta[]` — schema metadata                           |
| `login(email, password)` / `signup(input)` / `logout()`   | `{ token, user }` / `void` — see below                         |
| `getCurrentUser()`                                        | `AuthUser \| null`                                             |
| `getUsers()` / `createUser` / `updateUser` / `deleteUser` | user management (admin)                                        |

Bearer/`authToken` requests send the token on **reads as well as writes**, which is what makes drafts
and field-level read rules work for a signed-in editor over that path.

`login`/`signup`/`logout` are the low-level primitives — they exist so `ForgeAuthSession` (below) can
be built on `CmsApiService` alone, with zero extra dependencies. A real app should use
`ForgeAuthSession`, not these three directly; see [Browser auth](/docs/browser-auth).

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
drops out-of-order responses, and stays idle while params return `undefined`:

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

## Limits

- **No SSR-safe fetch or transfer state.** The base URL is relative and the service is browser-first.
  For a content site that needs SSR, call the [Local API](/docs/local-api) from a server route and
  hand the page a purpose-built payload — better for payload size anyway.
- **Documents are `Record<string, unknown>` by default.** Pass a type parameter
  (`listDocuments<Product>('products')`) — collection types reaching the client without codegen is
  still on the roadmap.
- No caching or normalised store.
