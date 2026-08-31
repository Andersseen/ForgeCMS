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
  providers: [
    provideForgeCms({
      baseUrl: '/api/v1',
      // A function is re-read on every request, so a login mid-session takes effect immediately.
      authToken: () => localStorage.getItem('forge-auth-token')
    })
  ]
};
```

`authToken` also accepts a plain string. Omit it entirely for a read-only public site.

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
| `login(email, password)`                                  | `{ token, user }`                                              |
| `getCurrentUser()`                                        | `AuthUser \| null`                                             |
| `getUsers()` / `createUser` / `updateUser` / `deleteUser` | user management (admin)                                        |

The token is sent on **reads as well as writes**, which is what makes drafts and field-level read
rules work for a signed-in editor.

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

```ts
import { ApiAuthError, ApiValidationError } from '@forge-cms/angular';

try {
  await cms.createDocument('bookings', form);
} catch (err) {
  if (err instanceof ApiValidationError) {
    // err.details → [{ field: 'email', message: '…', code: 'type_email' }]
  } else if (err instanceof ApiAuthError) {
    router.navigate(['/login']);
  }
}
```

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
