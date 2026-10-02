---
'@forge-cms/core': patch
'@forge-cms/db': patch
'@forge-cms/auth': patch
'@forge-cms/runtime': patch
'@forge-cms/angular': patch
'@forge-cms/admin': patch
---

Honest schema-to-wire types for the Angular client (spec 076, roadmap 0.8 C02). Patch level on purpose: the fixed group already moves to `0.9.0` through C01's pending minor changeset.

- `@forge-cms/angular`: share the content model's **type** with the browser (`type SiteSchema = ForgeSchema<typeof collections, [typeof siteSettings]>`, from `import type`, so no server code is bundled) and call `injectForgeClient<SiteSchema>()`. Slugs, `where`/`sort` fields, create/update payloads and results are checked against what the HTTP API sends: ISO date strings, `depth: 1` targets that may be `null` (many: readable targets only), access-controlled fields optional, `access.read: []` fields absent, localized fields a per-locale map without `locale` and a string with it, write results that may be only `{ id }`. New types: `ForgeSchema`, `ForgeDocument`, `ForgeCreateInput`, `ForgeUpdateInput`, `ForgeWriteResult`, `ForgeGlobalDocument`, `ForgeGlobalInput`, `ForgeWhere`, `ForgeSort`, `ForgeQueryOptions`, `UntypedDocument` and friends. `@forge-cms/core` is now a (type-only) dependency.
- **Migration:** `CmsApiService` is `CmsApiService<S = UntypedForgeSchema>`; `inject(CmsApiService)` is the untyped client (results `UntypedDocument`). The per-method response generic is removed — `getDocument<Post>(…)` no longer compiles: use the typed client, or treat results as untyped. `collectionResource<Post>(…)` becomes `collectionResource<SiteSchema, 'posts'>(…)` (or no type argument). Typed create/update results are `document | { id }`.
- **Dates (demo finding 24):** a date is an ISO-8601 `toISOString()` string at rest, on Local API reads and on the wire. `@forge-cms/runtime` canonicalizes every valid date on write (top-level and nested; before, in-memory echoed the caller's text and a numeric timestamp read back as `null` on libSQL/D1). `@forge-cms/db`'s `fromDbValue` returns the canonical string instead of a `Date`. `@forge-cms/core`: `DateField` reads as `string`; the typed Local API input takes `Date | string` (`FieldInputValue`, `InferInputFields`). **Local API reads of dates on libSQL/D1 are now strings** — use `new Date(value)` where a `Date` is needed.
- `@forge-cms/core`: `defineField.*` keep their options as literal types (`required`, `access`, `localized`, relation target and `many`, select options); `defineCollection`/`defineGlobal` keep a literal `drafts: true` (`DraftsFlag`); `FieldDefinition`'s options parameter is no longer constrained. A `required` localized field now rejects an empty per-locale map `{}`.
- `@forge-cms/auth`: `defineUsersCollection()` keeps a literal slug (`'users'` by default) instead of `string`, so registries containing it keep typed slugs.
- `@forge-cms/admin`: uses the untyped client (no behaviour change).
