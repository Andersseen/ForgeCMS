---
name: forgecms-content-modeling
description: Model business content in ForgeCMS - collections, globals, field kinds, drafts, versions, relations, uploads, hooks, access, and the documented limits.
---

# ForgeCMS content modeling

Model **business content** (services, pages, posts, site settings, navigation, SEO text) as collections and globals so the client edits it in the admin. Do not hardcode client copy into Angular templates.

```ts
import { defineCollection, defineField, defineGlobal } from '@forge-cms/core';

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  admin: { useAsTitle: 'title', defaultColumns: ['title'] },
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({ unique: true, autoGenerate: true, sourceField: 'title' }),
    body: defineField.richtext(),
    cover: defineField.upload({ collection: 'media' })
  },
  access: {
    read: () => true,
    create: ({ user }) => user?.role === 'admin' || user?.role === 'editor'
  }
});
```

## Field kinds (15)

`text`, `textarea`, `number`, `boolean`, `date`, `email`, `select`, `slug`, `json`, `richtext`, `relation`, `upload`, `group`, `array`, `blocks`. Use `defineField.<kind>()`. Check exact options with `forge_docs_search`.

## Rules and limits

- **Drafts:** `drafts: true` adds a `_status` (`draft` | `published`); unpublished documents are hidden from the public (publish with `_status: 'published'`), and draft visibility is enforced on reads, files and relations.
- **Versions:** `versions: true` keeps a snapshot on every write that you can list and restore.
- **Globals:** `defineGlobal({ slug, fields, access })`; the slug is an identifier (`siteSettings`, not `site-settings`). Singletons with `read`/`update` access only (no create/delete access or delete hooks). Use them for site settings and navigation.
- **Relations:** `depth` is `0` (ids) or `1` (referenced documents); nothing deeper. Relations inside `group`/`array`/`blocks` are refused at startup. `onDelete`: `restrict` (default), `cascade`, `set-null`.
- **Uploads:** an upload-enabled collection (`upload: true`) plus `defineField.upload({ collection })`. No image processing, no presigned uploads.
- **Localization:** top-level `text`/`textarea` only - see the `forgecms-localization` skill.
- **Hooks:** nine collection stages plus field hooks; keep them small and deterministic. Hooks receive `overrideAccess`.
- **Access:** every collection needs explicit access rules; see `forgecms-auth-access`.
- **Blocks/arrays/groups:** recursive, but a stored block whose type left the schema is preserved until removed deliberately.
- **Schema drift:** after changing fields, `planSchema()` shows what changed. Safe changes sync automatically; risky ones need a reviewed migration (`forgecms-migrations-recovery`).
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are usually on: use conditional spreads instead of passing `undefined`.
