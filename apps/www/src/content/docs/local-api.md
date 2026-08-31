---
title: Local API
description: find, findOne, findByID, create, update, delete and count — the way to use ForgeCMS from server code.
group: Server APIs
order: 1
---

The Local API is `ForgeCmsRuntime`'s seven methods. Each runs the whole pipeline — access control,
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

`where` supports `eq` (bare value), `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`, plus `containsValue`
for `relation({ many: true })` array-membership:

```ts
where: {
  category: 'facial',                    // equality
  price: { gte: 50, lte: 200 },          // range
  id: { in: ['a', 'b', 'c'] },
  title: { contains: 'laser' },          // case-insensitive
  specialties: { containsValue: serviceId } // relation({ many: true }) array membership
}
```

### Nested `and`/`or`

`and`/`or` compose recursively and combine with the field operators above — an implicit `and` across
top-level keys still works exactly as before:

```ts
const result = await runtime.find({
  collection: 'posts',
  where: {
    and: [
      { status: 'published' },
      {
        or: [{ featured: true }, { views: { gte: 1000 } }]
      }
    ]
  },
  sort: [
    { field: 'featured', order: 'desc' },
    { field: 'created_at', order: 'desc' }
  ]
});
```

`sort` accepts a single field name (unchanged) or a `{ field, order }[]` for a multi-field, stable
sort — the first field decides, ties fall through to the next. Behavior is identical across the
InMemory, libSQL, and D1 adapters. Querying _inside_ `group`/`array`/`blocks` JSON values is still not
supported (they are JSON in a single column) — `containsValue` only reaches `relation` arrays.

An access-rule constraint (`access.read` returning a query) is always AND-composed around whatever
`where` the caller supplies — a nested `or` in the caller's query can never widen out of a row-level
access constraint; see [Access control](/docs/access-control).

## `findByID`

```ts
const post = await runtime.findByID({ collection: 'posts', id, depth: 1 });
```

Throws `NotFoundError` if it does not exist — or if an access constraint excludes it, so ids are not
leaked by a 403.

## `findOne`

The same read pipeline as `find` (access, hooks, drafts, locale, relation population), narrowed to at
most one document — `null`, not a thrown error, when nothing matches:

```ts
const post = await runtime.findOne({ collection: 'posts', where: { slug: 'hello-world' } });
post?.title; // string, typed from the collection definition — or undefined if post is null
```

Replaces the old `find({ where, limit: 1 }).docs[0]` workaround: no pagination metadata is computed,
so it goes straight to the database with a real `LIMIT 1`.

## `count`

```ts
const pending = await runtime.count({ collection: 'bookings', where: { status: 'pending' } });
```

`count` shares the exact same query-preparation path as `find` — including nested `and`/`or` and
access-rule composition — so a filtered `count` and a filtered `find` never disagree about how many
documents match.

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

| Error                   | Status | Thrown when                                                                                                           |
| ----------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| `NotFoundError`         | 404    | Unknown collection, unknown id, invisible document                                                                    |
| `InvalidInputError`     | 400    | Malformed query, bad JSON, bad multipart body                                                                         |
| `UnknownFieldError`     | 400    | `where`/`sort` names a field the collection doesn't have                                                              |
| `InvalidQueryError`     | 400    | Malformed `and`/`or` group (empty, wrong shape), bad operator/sort direction, `containsValue` on a non-relation field |
| `ValidationFailedError` | 400    | Field validation failed — carries `details`                                                                           |
| `UnauthorizedError`     | 401    | Authentication required                                                                                               |
| `AccessDeniedError`     | 403    | Authenticated but not permitted                                                                                       |

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
