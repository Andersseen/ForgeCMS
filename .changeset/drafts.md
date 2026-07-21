---
'@forge-cms/core': minor
'@forge-cms/db': minor
'@forge-cms/runtime': minor
---

Added draft/published status for collections (spec 017): `defineCollection({ ..., drafts: true })` adds a
system `_status: 'draft' | 'published'` field. New documents default to `'draft'` unless the body (or a
`beforeChange` hook) sets it explicitly. Anonymous `GET` requests — list and single — only ever see
`published` documents on a drafts-enabled collection; a `draft` single-document read `404`s for
unauthenticated requests rather than exposing a `403` (existence isn't leaked). Authenticated requests opt
in to seeing drafts via `?status=draft` or `?status=all` on the list endpoint; the default stays
published-only even when authenticated. Collections without `drafts: true` are completely unaffected — no
schema change, no filtering, no behavior change.

This is draft/published status only, not a version-history system — no past-revision retention, diffing,
or restore. That remains open for a future spec.
