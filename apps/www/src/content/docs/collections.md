---
title: Collections
description: defineCollection, the options it takes, drafts, indexes, and how the schema reaches the database.
group: Content modelling
order: 1
---

A collection is a document type. `defineCollection` returns a plain object — nothing is registered
globally, so you export it and pass it to the runtime.

```ts
import { defineCollection, defineField } from '@forge-cms/core';

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  fields: {
    title: defineField.text({ required: true, maxLength: 120 }),
    slug: defineField.slug({ autoGenerate: true, sourceField: 'title' }),
    excerpt: defineField.textarea(),
    body: defineField.richtext(),
    publishedAt: defineField.date({ withTime: true }),
    author: defineField.relation({ collection: 'users' })
  },
  access: {
    read: () => true,
    create: ['admin', 'editor'],
    update: ['admin', 'editor'],
    delete: ['admin']
  },
  hooks: {
    beforeChange: [({ data }) => ({ ...data, updatedBy: 'system' })]
  }
});
```

## Options

| Option    | Type                  | Meaning                                                                |
| --------- | --------------------- | ---------------------------------------------------------------------- |
| `slug`    | `string` (required)   | Table name, URL segment, and the key every API call uses               |
| `fields`  | `FieldMap` (required) | See [Fields](/docs/fields)                                             |
| `access`  | `CollectionAccess`    | Per-operation rules. See [Access control](/docs/access-control)        |
| `hooks`   | `CollectionHooks`     | Nine lifecycle stages. See [Hooks](/docs/hooks)                        |
| `drafts`  | `boolean`             | Adds a `_status` field and hides unpublished documents from the public |
| `upload`  | `boolean`             | `POST` accepts `multipart/form-data`. See [Uploads](/docs/uploads)     |
| `indexes` | `CollectionIndex[]`   | Compound indexes/unique constraints — see [Indexes](#indexes) below    |

## Types come free

`CollectionData<typeof posts>` infers the document shape from the field definitions — including
nested `group` and `array` fields:

```ts
import type { CollectionData } from '@forge-cms/core';

type Post = CollectionData<typeof posts>;
// { title: string; slug: string; excerpt: string; body: RichTextContent;
//   publishedAt: Date; author: string | string[] }
```

Note that this is the **schema** shape, not the API response shape: documents read back from the
database also carry `id`, `created_at`, `updated_at`, and `_status` on a `drafts` collection. Typed
documents flowing all the way to the client without codegen is still on the roadmap.

## From definition to database

`runtime.syncSchema()` walks every registered collection and:

1. creates the table if it does not exist (`generateCreateTableSql`), with `id`, `created_at`,
   `updated_at`, plus `_status` when `drafts: true`;
2. compares the declared fields against `PRAGMA table_info` and issues `ALTER TABLE … ADD COLUMN`
   for anything new (`generateAddColumnSql`);
3. creates any declared indexes with `CREATE [UNIQUE] INDEX IF NOT EXISTS` (`generateIndexSql`) — see
   [Indexes](#indexes) below.

**Migrations are additive only.** Columns are never dropped or retyped, so renaming a field means
adding a new column, and removing one leaves the old column in place. That is a deliberate
constraint — it keeps schema sync safe to run on every cold start — but plan around it. Composite
fields (`group`, `array`, `blocks`) are stored as JSON in a `TEXT` column, which is why you cannot
query inside them yet.

## Indexes

Two ways to index a field, both reflected in the generated SQL:

```ts
slug: defineField.slug({ index: true }); // a plain index
email: defineField.email({ unique: true }); // a unique index
```

For a constraint that spans **more than one field** — the common case is "this combination of fields
must be unique" — use the collection's `indexes` option instead:

```ts
export const catalogs = defineCollection({
  slug: 'catalogs',
  fields: {
    project: defineField.relation({ collection: 'projects', required: true }),
    locale: defineField.text({ required: true }),
    namespace: defineField.text()
  },
  indexes: [{ fields: ['project', 'locale', 'namespace'], unique: true }]
});
```

This rejects a second `catalogs` document with the same `(project, locale, namespace)` triple, while
happily allowing `(A, en, '')` alongside `(A, es, '')`. **Field order matters** — it is the column
order of the generated index, so `['project', 'locale']` and `['locale', 'project']` are two different
indexes with two different (deterministic) names. Omit `unique` for a plain compound index with no
constraint, just a query optimization.

Index names are generated for you (`idx_<collection>_<field1>_<field2>…`) — there is no way to name
one yourself, so nothing here can collide with a name your own migration tooling might pick.

A conflict — whether from a single-field `unique: true` or a compound `indexes` entry — throws a
`UniqueConstraintError` from the Local API (`err.code === 'UNIQUE_CONSTRAINT'`, `err.collection`,
`err.fields`) and comes back as HTTP `409` from the REST API. This is enforced identically on D1,
libSQL, **and** the in-memory adapter, so a compound-uniqueness bug fails in local dev/tests exactly
like it would in production, instead of only surfacing against a real database.

Indexes cannot reach _inside_ a `group`/`array`/`blocks` field — those are JSON in a single `TEXT`
column, the same limitation querying them already has.

## Drafts

Set `drafts: true` and the collection gains a system field `_status: 'draft' | 'published'`:

- **create** defaults `_status` to `'draft'`;
- **anonymous reads** only ever see `published` documents — a draft 404s by id and is filtered from
  lists;
- **authenticated reads** opt in with `status=draft`, `status=published` or `status=all` (HTTP) or
  the `status` argument (Local API);
- collections without `drafts: true` ignore all of it.

```ts
// Editors' view: everything
await runtime.find({ collection: 'posts', status: 'all', user, overrideAccess: false });

// Public site: the default, published only
await runtime.find({ collection: 'posts', overrideAccess: false, user: null });
```

This is publication status, not version history — there is no diff, restore or autosave.

## Registering collections

```ts
const runtime = new ForgeCmsRuntime({
  collections: [posts, media, withAuthFields(users)],
  adapters: { database, auth, storage },
  env
});

runtime.init();
await runtime.syncSchema();
```

`withAuthFields()` from `@forge-cms/auth` merges the columns the auth adapter writes
(`passwordHash`, `role`, …) into your `users` collection, so schema generation covers them. Skipping
it is how you get a `table users has no column named passwordHash` error in production.

## A note on the users collection

The collection your `AuthAdapter` uses is a normal collection: you define it, you can add fields to
it, and it shows up in the admin. `UsersCollectionAuthAdapter` defaults to the slug `users`. See
[Adapters](/docs/adapters) for the auth side.
