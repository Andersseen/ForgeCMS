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

This is publication status, not version history — see [Version history](#version-history) below.

## Version history

Set `versions: true` and every write keeps a snapshot you can list and restore:

```ts
const posts = defineCollection({ slug: 'posts', versions: true, fields: { … } });

const history = await runtime.listVersions({ collection: 'posts', documentId: id }); // newest first
await runtime.restoreVersion({ collection: 'posts', versionId: history[1].id });
```

What you can rely on:

- **The document and its snapshot are written together.** `create` writes the document and version 1,
  `update` and `restoreVersion` write the change and the next version, as one atomic database write
  (`DatabaseAdapter.atomicWrite()`). If either part fails, neither is saved. File uploads are the
  exception: an upload's stored object is not part of that write.
- **A snapshot is the full content**, not just the fields an update touched: every field the collection
  declares (`null` when empty), plus `_status` on a drafts collection. It never contains `id`,
  `created_at`, `updated_at` or the internal storage key, and a restore never changes them.
- **Two edits to the same document at once don't silently overwrite each other.** If two updates
  start from the same version, one saves and the other fails with `ConcurrentModificationError`
  (HTTP `409`, `CONCURRENT_MODIFICATION`) and saves nothing. Forge does not retry it for you, because
  your `before*` hooks may already have run. Reload the document and submit the change again.
- **Version numbers are unique per document** (`1, 2, 3, …`), enforced by a unique database index.
- **Restore runs the normal update pipeline**: update access, field write rules (checked for the
  fields the restore actually changes), validation and hooks, then writes one version labelled
  `Restored from version N`. A snapshot from before a field became required fails validation. Old
  versions stay readable, but they are not automatically valid documents today.
- **History is kept indefinitely.** Deleting a document does not delete its versions. Over HTTP the
  history of a deleted document answers `404`, and a restore of it answers `404`. You can't create a
  new document with the id of a deleted document that still has history.
- Call `runtime.syncSchema()` at startup (as in setup above): it creates the version-number index the
  conflict detection relies on.
- A `before*` hook must not call `update()` on the document being updated: that saves a version first,
  so the outer update fails with `ConcurrentModificationError`. Change `data` in the hook instead.
- `runtime.createVersion()` (Local API only) stores a snapshot you pass in yourself: no hooks, no access
  checks, stored exactly as given.
- `versions: { autosave: true }` is accepted but currently does nothing. There is no editor autosave.

**Upgrading from an earlier release:** `syncSchema()` adds the version-number index to existing
`_versions_*` tables. Two updates that ran at the same moment in earlier releases could leave two rows
with the same version number for one document. If your database has such rows, `syncSchema()` stops
with a message listing them. Forge never deletes or renumbers history for you: back up the database,
decide which rows to keep, fix them, then restart. Snapshots written by earlier releases hold only the
fields that update changed; restoring one applies only those fields.

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

The collection your `AuthAdapter` uses is a normal collection for _reading_: you define it, you can add
fields to it, and it shows up in the admin. `UsersCollectionAuthAdapter` defaults to the slug `users`.
It is **not** a normal collection for _writing_: while an auth adapter manages it, generic
`create`/`update`/`delete` — the Local API (trusted or not) and `/api/v1/users` — are refused with
`AUTH_MANAGED_COLLECTION`, and users are created, changed and deleted through the auth adapter
(`createUser`, `updateUser`, `deleteUser`, `signup`). See [Browser auth](/docs/browser-auth) and
[Adapters](/docs/adapters) for the auth side.
