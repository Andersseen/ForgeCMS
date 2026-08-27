---
title: Local API
description: find, findByID, create, update, delete and count — the way to use ForgeCMS from server code.
group: Server APIs
order: 1
---

The Local API is `ForgeCmsRuntime`'s six methods. Each runs the whole pipeline — access control,
hooks, drafts, relation population, validation — as a plain function call, with no HTTP hop and no
`Request` to fabricate.

**This is the intended way to use ForgeCMS from server code**: an Analog server route, a Nitro
handler, a seed script, a scheduled job. The HTTP handlers are a thin transport layer over exactly
these methods.

```ts
const runtime = await getServerRuntime(env);

const { docs, totalDocs, hasNextPage } = await runtime.find({
  collection: 'posts',
  where: { published: true, views: { gte: 100 } },
  sort: 'publishedAt',
  order: 'desc',
  limit: 10,
  depth: 1
});
```

## Typed inference

`defineCollection`'s schema feeds straight into every Local API method's types — no codegen, no
`as const` required:

```ts
const posts = defineCollection({
  slug: 'posts',
  fields: {
    title: defineField.text({ required: true }),
    views: defineField.number(),
    metadata: defineField.json<{ featured: boolean }>()
  }
});

const runtime = new ForgeCmsRuntime({ collections: [posts, authors], adapters });

const page = await runtime.find({ collection: 'posts' });
page.docs[0].title; // string
page.docs[0].metadata.featured; // boolean

const created = await runtime.create({
  collection: 'posts',
  data: { title: 'Hello', views: 1 } // unknown fields/wrong value types are a compile error
});
created.title; // string

runtime.find({ collection: 'does-not-exist' }); // compile error: not a registered collection
```

`defineField.json<T>()` is a **compile-time annotation only** — `T` flows through `find`/`create`/
`update`'s inferred types, but nothing validates that the stored JSON actually matches `T` at
runtime. `defineField.json()` (no type argument) still infers `unknown`, exactly as before; keep
validating untrusted JSON yourself. A runtime built from a widened/dynamic `CollectionDefinition[]`
(or a `ForgeCmsRuntime<TEnv>` given only its environment type) still compiles and still works —
every method just accepts a plain `string` and returns a loosely-typed document, the same shape the
Local API always returned.

## Shared arguments

Every method accepts these:

| Argument         | Type              | Default    | Meaning                                             |
| ---------------- | ----------------- | ---------- | --------------------------------------------------- |
| `collection`     | `string`          | —          | The collection slug (required)                      |
| `user`           | `CmsUser \| null` | `null`     | Who the operation runs as                           |
| `overrideAccess` | `boolean`         | **`true`** | Skip access checks — see the warning below          |
| `depth`          | `0 \| 1`          | `0`        | `1` replaces relation/upload ids with the documents |

> **`overrideAccess` defaults to `true`.** A direct call is assumed to come from trusted server code.
> Anything acting on a visitor's behalf must pass `overrideAccess: false` together with the resolved
> `user` — that is exactly what the HTTP layer does. See [Access control](/docs/access-control).

## `find`

```ts
const page = await runtime.find({
  collection: 'services',
  where: { category: 'facial', price: { lte: 200 } },
  sort: 'order',
  order: 'asc',
  limit: 20,
  offset: 0,
  status: 'published'
});
```

Returns `PaginatedDocs`:

```ts
interface PaginatedDocs {
  docs: Record<string, unknown>[];
  /** Total matching the query, ignoring limit/offset. */
  totalDocs: number;
  limit: number | undefined;
  offset: number;
  /** 1-based, derived from limit/offset. */
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}
```

`where` supports `eq` (bare value), `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`:

```ts
where: {
  category: 'facial',                    // equality
  price: { gte: 50, lte: 200 },          // range
  id: { in: ['a', 'b', 'c'] },
  title: { contains: 'laser' }           // case-insensitive
}
```

Limits worth knowing: **one sort field**, no `OR`, and no querying inside `group`/`array`/`blocks`
values (they are JSON in a single column).

## `findByID`

```ts
const post = await runtime.findByID({ collection: 'posts', id, depth: 1 });
```

Throws `NotFoundError` if it does not exist — or if an access constraint excludes it, so ids are not
leaked by a 403.

## `count`

```ts
const pending = await runtime.count({ collection: 'bookings', where: { status: 'pending' } });
```

## `create`

```ts
const post = await runtime.create({
  collection: 'posts',
  data: { title: 'Hello', body: [] },
  user,
  overrideAccess: false
});
```

Applies defaults and auto-slugs, runs `beforeValidate` → validation → `beforeChange` → the write →
`afterChange`, and returns the stored document.

## `update`

```ts
const post = await runtime.update({ collection: 'posts', id, data: { title: 'New title' } });
```

Partial by design: fields you omit keep their stored values, and a required field already present on
the record does not have to be repeated.

## `delete`

```ts
const removed = await runtime.delete({ collection: 'posts', id });
```

Returns the deleted document, having run `beforeDelete` and `afterDelete`. It does **not** delete
related storage objects or clean up references.

## Errors

Typed, each carrying its HTTP status — so the transport layer maps them without a translation table:

| Error                   | Status | Thrown when                                        |
| ----------------------- | ------ | -------------------------------------------------- |
| `NotFoundError`         | 404    | Unknown collection, unknown id, invisible document |
| `InvalidInputError`     | 400    | Malformed query, bad JSON, bad multipart body      |
| `ValidationFailedError` | 400    | Field validation failed — carries `details`        |
| `UnauthorizedError`     | 401    | Authentication required                            |
| `AccessDeniedError`     | 403    | Authenticated but not permitted                    |

```ts
import { isForgeError, ValidationFailedError } from '@forge-cms/runtime';

try {
  await runtime.create({ collection: 'bookings', data, user, overrideAccess: false });
} catch (err) {
  if (err instanceof ValidationFailedError) return { errors: err.details };
  if (isForgeError(err)) return { error: err.message, status: err.status };
  throw err;
}
```

## A complete public endpoint

The pattern the demo app uses for every public route — the site runs under real anonymous access
rules, so a rule that hides drafts hides them here too:

```ts
// apps/<app>/src/server/routes/api/site/services.get.ts
import { defineEventHandler } from 'h3';
import { getServerRuntime } from '../../../api/runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const asVisitor = { overrideAccess: false, user: null } as const;

  const [services, categories] = await Promise.all([
    runtime.find({ collection: 'services', sort: 'order', limit: 50, depth: 1, ...asVisitor }),
    runtime.find({ collection: 'service_categories', sort: 'order', limit: 20, ...asVisitor })
  ]);

  return { services: services.docs, categories: categories.docs };
});
```

Returning a purpose-built payload rather than raw documents is worth the extra file: the browser
downloads what the page needs, not the whole content model.
