---
title: Core concepts
description: Collections, the runtime, adapters, and the two APIs — the whole mental model.
group: Getting started
order: 3
---

Five ideas cover almost everything.

## 1. A collection is a TypeScript definition

`defineCollection` describes a document type: its `slug` (which becomes the table name and the URL
segment), its fields, and optionally its `access` rules, `hooks`, `drafts` flag and `upload` flag.
It is a plain object — no class, no decorator, no registry.

```ts
const posts = defineCollection({
  slug: 'posts',
  fields: { title: defineField.text({ required: true }) }
});
```

That single definition is consumed by the schema generator (to create the SQL table), by the
validator (on every write), by the admin UI (to build the form), and by the client (which fetches
field metadata from `/api/v1/collections`).

## 2. The runtime binds collections to adapters

```ts
const runtime = new ForgeCmsRuntime({
  collections: [posts, media, users],
  adapters: {
    database: new InMemoryDatabaseAdapter(),
    auth: new UsersCollectionAuthAdapter(),
    storage: new InMemoryStorageAdapter()
  },
  env
});

runtime.init(); // hands `env` to each adapter
await runtime.syncSchema(); // creates tables, adds new columns
```

`ForgeCmsRuntime` is the CMS instance. It owns nothing but the config and the adapters — all the
behaviour lives in operations that take the runtime as context.

## 3. Adapters are the only thing that touches the outside world

Three contracts, each a small interface:

| Contract          | Package              | Implementations                                          |
| ----------------- | -------------------- | -------------------------------------------------------- |
| `DatabaseAdapter` | `@forge-cms/db`      | InMemory, LibSQL (Turso), D1 (`@forge-cms/cloudflare`)   |
| `AuthAdapter`     | `@forge-cms/auth`    | InMemory, External (token), SignedToken, UsersCollection |
| `StorageAdapter`  | `@forge-cms/storage` | InMemory, R2 (`@forge-cms/cloudflare`)                   |

Nothing above the adapter layer knows whether it is talking to SQLite in a file, D1 at the edge, or
a `Map` in a test. Any adapter you write must pass the shared contract test suites — see
[Adapters](/docs/adapters).

## 4. There are two APIs, and the Local one is primary

**The Local API** is `runtime.find(...)`, `runtime.create(...)` and friends. It runs the whole
pipeline — access control, hooks, drafts, relation population, validation — as a function call. This
is how server code should use ForgeCMS: an Analog server route, a seed script, a scheduled job.

**The HTTP API** (`/api/v1/*`) is a thin transport layer over exactly those operations: parse the
query string, resolve the user, call the operation, wrap the result in the JSON envelope, map typed
errors to status codes. No business logic lives there.

The one behavioural difference is trust:

```ts
// Local API: trusted server code, access checks skipped by default
await runtime.find({ collection: 'posts' });

// HTTP layer (and anything acting on a visitor's behalf): checks enforced
await runtime.find({ collection: 'posts', overrideAccess: false, user });
```

`overrideAccess` defaults to `true` for direct calls and is always `false` from HTTP. If you build a
public endpoint on the Local API, **pass `overrideAccess: false` explicitly** — otherwise your
public route runs as a superuser.

## 5. Every write goes through the same pipeline

```txt
create / update
   │
   ├─ access check ....... collection `access.create` / `access.update`, and field-level `access.write`
   ├─ defaults ........... defaultValue, slug autoGenerate
   ├─ beforeOperation .... side effects, per operation
   ├─ beforeValidate ..... collection hooks, then field hooks — normalise / derive here
   ├─ validation ......... @forge-cms/core, per field, 400 on failure
   ├─ beforeChange ....... last chance to change what gets stored
   ├─ the write .......... DatabaseAdapter
   ├─ afterChange ........ side effects; cannot fail the committed write
   └─ afterOperation ..... side effects, per operation
```

Reads mirror it with `beforeRead` (may narrow the query), the query itself, relation population,
field-level read filtering, and `afterRead` per document. See [Hooks](/docs/hooks) and
[Access control](/docs/access-control).

## The package map

| Package                 | What it is                                                                   |
| ----------------------- | ---------------------------------------------------------------------------- |
| `@forge-cms/core`       | Schema DSL (`defineCollection`, `defineField`) + runtime validation          |
| `@forge-cms/db`         | `DatabaseAdapter` contract, InMemory + LibSQL adapters, SQL schema generator |
| `@forge-cms/auth`       | `AuthAdapter` contract, users-collection auth, roles, token signing          |
| `@forge-cms/storage`    | `StorageAdapter` contract + in-memory adapter                                |
| `@forge-cms/runtime`    | The orchestrator: operations, hooks, access, HTTP handlers                   |
| `@forge-cms/cloudflare` | D1 + R2 adapters                                                             |
| `@forge-cms/angular`    | Browser client: `CmsApiService`, signal resources, `provideForgeCms`         |
| `@forge-cms/admin`      | Angular admin components (layout, list, schema-driven form, field widgets)   |
| `@forge-cms/testing`    | Adapter contract test suites                                                 |
| `@forge-cms/api`        | Shared `ApiContext` / handler types                                          |

Import packages through their entry point (`@forge-cms/db`), never a deep path into `src/`. The one
official exception is `@forge-cms/testing/contracts`.
