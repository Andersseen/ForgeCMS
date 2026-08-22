# 044 — Translation Catalog Management

- **Status:** done
- **Author:** agent draft
- **Date:** 2026-08-22
- **Branch:** feature/044-translation-catalog-management
- **Affected packages/apps:** @forge-cms/runtime (describe, handlers), @forge-cms/angular (types, query, api.service), @forge-cms/admin (field-control, collection-form), apps/www (one collection-form call site)

> **This repository ships only the generic fix.** The translation-catalog-management app described
> throughout this spec (`apps/demo-i18n` below) was built and fully verified as the vehicle for
> proving the design, then — per explicit maintainer direction — moved **out of this repository**
> entirely before anything was committed: it must not live in, ship from, or be linked from
> ForgeCMS's own repo or its public site, the same way a real consumer's app would sit in its own
> project and depend on ForgeCMS rather than living inside it. It now lives at
> `../forgecms-i18n-catalogs-reference` (a sibling directory, not a workspace member, not tracked by
> this repo's git history) as a reference for building the real thing later. Every `apps/demo-i18n/…`
> path below describes where that code lived _while it was being built_, not anything present in this
> repository today — see Outcome.

## Context / Why

The maintainer manages translation JSON catalogs by hand for several personal projects (Volt UI,
Imagineryx, Etyma playground), each with its own locale set. A first attempt at this feature
(commit `8d0169d`, reverted 3 minutes later in `597a146`) built it correctly at the code level —
tests passed, `pnpm lint && pnpm typecheck && pnpm test && pnpm build` were all green — but got the
placement wrong: it added `translation_projects`/`translation_messages` collections directly to
`apps/www`'s own runtime, and — more importantly — edited `packages/admin/src/config.ts`'s
`DEFAULT_ADMIN_NAV` to add a permanent "Translations" link. That change would have shipped a
translation-specific nav item to _every_ consumer of `@forge-cms/admin*`, regardless of whether they
use this feature. The maintainer's explicit correction: ForgeCMS itself must stay generic (by
payload/schema type — plain collections, relations, hooks, JSON fields), and translation catalog
management is a _feature built with ForgeCMS_, proven the same way `apps/demo-aesthetics` proves the
CMS works for a real clinic site — as an independent consuming app, not a change to the product's own
admin surface.

## Goal

ForgeCMS can manage translation JSON catalogs for multiple projects with independent locale sets —
create a project, import/export nested JSON per locale, store messages in a normalized model — with
**zero translation-specific code inside any `@forge-cms/*` package**. A new app,
`apps/demo-i18n`, is the thing that actually implements the feature, using only generic collections,
relations, hooks and the Local API.

## Non-goals

- Dedicated multi-column translation editor / spreadsheet UI
- Completion percentages, missing-key dashboard
- MF2 validation (Etyma's responsibility) — translation values are opaque strings
- Etyma runtime/MCP integration
- Publish/release snapshots, immutable catalog URLs, public CDN endpoints, remote deployment (no
  `wrangler.toml`/D1/R2 wiring in this iteration — see Design)
- AI translation, translation memory, glossary, reviewer/approval workflows, teams, billing
- Git sync

## Design

### Where this lives, and why

| Layer                  | Change                                                                                                                                                                                    | Why here                                                                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/runtime`     | `FieldDescription.localized`, `CollectionDescription.locales`, `?locale=` parsed and forwarded on list/read/**create/update**                                                             | Generic gap: localization (Phase 0.3.4) never propagated past the describe/HTTP layer. Nothing translation-specific.                                                                                 |
| `packages/angular`     | `FieldMeta.localized`, `CollectionMeta.locales`, `QueryOptions.locale`, `locale` option on `getDocument`/`createDocument`/`updateDocument`                                                | Mirrors the runtime change for the client SDK.                                                                                                                                                       |
| `packages/admin`       | `ForgeFieldControlComponent` renders a locale-tab picker when a field is `localized` and locales are available; `ForgeCollectionFormComponent` gained a `locales` input to pass them down | Closes the _generic_ localization feature end-to-end — usable by any collection, not just translation projects. `packages/admin/src/config.ts` (`DEFAULT_ADMIN_NAV`) is **not** touched — see below. |
| `apps/www`             | `collection-detail.page.ts` now passes `[locales]="col.locales ?? []"`                                                                                                                    | Wires the generic fix into the one real admin that ships today.                                                                                                                                      |
| `apps/demo-i18n` (new) | Everything translation-specific: `translation_projects`/`translation_messages` collections, `catalog-utils`/`import-service`/`export-service`, HTTP routes, the one bespoke admin page    | This is the "feature built with ForgeCMS" — see below.                                                                                                                                               |

`packages/admin`'s sidebar nav is already extensible per-app: `ForgeAdminConfig.nav`, passed via the
`/admin` route's `data.config` (spec 042), overrides `DEFAULT_ADMIN_NAV` entirely. `apps/demo-i18n`
uses exactly that — its own `app.routes.ts` supplies a nav with a "Translations" entry — so
`packages/admin` needed **zero changes** to give this feature a nav link. This is the concrete
mechanism that keeps the feature out of the shared product.

### Data model (apps/demo-i18n/src/server/api/runtime.ts)

Two ordinary collections, defined with `defineCollection`/`defineField` like any other ForgeCMS
collection:

```ts
const translationProjects = defineCollection({
  slug: 'translation_projects',
  fields: {
    name: defineField.text({ required: true }),
    slug: defineField.slug({
      sourceField: 'name',
      autoGenerate: true,
      required: true,
      unique: true
    }),
    sourceLocale: defineField.text({ required: true }),
    locales: defineField.json({ required: true }), // string[], e.g. ["en", "es", "uk"]
    description: defineField.textarea()
  },
  hooks: {
    beforeChange: [
      /* locales/sourceLocale/slug validation, see below */
    ]
  }
});

const translationMessages = defineCollection({
  slug: 'translation_messages',
  fields: {
    project: defineField.relation({
      collection: 'translation_projects',
      required: true,
      onDelete: 'cascade'
    }),
    key: defineField.text({ required: true }), // canonical dot notation, e.g. "nav.docs"
    translations: defineField.json({ required: true }), // { en: "Docs", es: "Documentación" }
    description: defineField.text()
  },
  hooks: {
    beforeChange: [
      /* key/translations validation + (project, key) uniqueness, see below */
    ]
  }
});
```

`locales` is a per-project `json` array field, deliberately **not** the collection-level `locales`
config (`CollectionDefinition.locales`) — that config is one shared locale set for one collection,
and this domain needs an independent locale set per project. One giant mutable JSON blob per locale
was also rejected as the primary store: `translations` on a _message_ is JSON (a small, bounded
object keyed by that message's own locales), but the source of truth is one row per flattened key,
not one row per locale per project.

### Compound uniqueness (project, key)

ForgeCMS's field-level `unique: true` is single-field only, so `(project, key)` uniqueness cannot be
declared on the schema. It is enforced in the `translation_messages` `beforeChange` hook instead,
which queries the runtime for an existing sibling with the same `project` + `key` and rejects the
write if one exists (excluding the document being updated). Hooks receive no handle on the runtime
(`apps/demo-aesthetics`'s finding 23), so the hook reaches for the same module-level
`runtime-ref.ts` singleton that demo already uses for its own lookup rules. `translation_projects.slug`
uniqueness is enforced the same way, as a second layer on top of the field's `unique: true` (which
only the D1/LibSQL schema generator honors — the in-memory adapter used in dev/tests does not).

**Known limitation, called out on purpose:** ForgeCMS has no generic compound-unique-index
primitive. If this need recurs, that is the signal to add one to `@forge-cms/core`/`@forge-cms/db`
rather than writing another per-collection hook.

### Key grammar and catalog flattening (apps/demo-i18n/src/server/translations/catalog-utils.ts)

Pure, dependency-free functions, shared by the collection hooks and the import/export services (one
place for this logic, not duplicated per layer):

- `flattenCatalog(catalog)` → `{ entries: Map<key, value>, errors: FlattenError[] }`. Nested objects
  become dot-notation namespaces; leaf strings are messages; arrays/`null`/numbers/booleans produce a
  per-key error rather than being coerced or silently dropped.
- `unflattenCatalog(messages)` → nested `Record<string, unknown>`, alphabetically ordered (deterministic).
- `validateTranslationKey(key)` — non-empty, no leading/trailing/consecutive dots, segments restricted
  to `[a-zA-Z0-9_-]`. Message _values_ are unrestricted Unicode — `"Hello {$name}"` round-trips exactly.
- `validateLocale(locale)` / `validateProjectLocales(locales)` — lightweight BCP-47-_like_ check
  (`en`, `es-MX`, `pt-BR`, `zh-Hant`), not a full locale database.

### Import/export services

`importTranslationCatalog(runtime, projectSlug, locale, catalog)`: validates the project and locale,
flattens the catalog, and for each key either creates a new message (`{ [locale]: value }`) or merges
`value` into that locale of an existing message's `translations`, leaving every other locale
untouched. Never deletes — a key absent from the new import is left alone. Returns
`{ created, updated, unchanged, total, errors }`. All persistence goes through `runtime.create`/
`runtime.update`/`runtime.find` (`overrideAccess: true`, since the HTTP route already authenticated
the caller) — hooks and validation run exactly as they would for any other write.

`exportTranslationCatalog(runtime, projectSlug, locale, { fallback })`: reads every message for the
project, picks each one's value for the requested locale, and rebuilds canonical nested JSON via
`unflattenCatalog`. `fallback: 'none'` (default) omits a key with no value for that locale;
`fallback: 'source'` substitutes the project's source-locale value instead. No ForgeCMS envelope, no
metadata mixed into the output — this is a translation artifact, not an API response.

### HTTP API

```
POST /api/v1/translations/:project/import/:locale   — body: nested JSON catalog. Requires admin/editor.
GET  /api/v1/translations/:project/catalog/:locale   — ?fallback=none|source. Requires authentication.
```

Thin `h3` route handlers over the two services above — not forced through `handleCreate`/`handleList`,
since "import a catalog" isn't one of the generic CRUD verbs. They reuse the CMS's own error envelope
(`{ error: { code, message } }`, matching `packages/runtime/src/handlers.ts`'s `errorResponse()`
shape) rather than inventing a new one. `translation_projects`/`translation_messages` also get full
generic CRUD for free through the existing `/api/v1/:collection` catch-all routes (same
`allowedRoles: ['admin', 'editor']` gate every other collection in this app uses) — the bespoke routes
above exist only for the operations the generic CRUD verbs cannot express.

Payload size is capped at 2 MiB in `import-service.ts` to reject an accidental multi-megabyte paste.

### Angular SDK / Admin

No new `CmsApiService` methods: project CRUD uses the existing generic `getDocuments`/
`createDocument`/`updateDocument`, and import/export are domain-specific enough that the admin page
calls `fetch` directly (matching the app's own auth-token convention) rather than growing
`CmsApiService` into "twenty unrelated methods."

The one bespoke admin surface is `apps/demo-i18n/src/app/pages/admin/translations.page.ts`:

- Project list + create/edit reuse `ForgeCollectionFormComponent` bound to the real
  `translation_projects` schema (fetched via `getCollections()`) — the same generic component
  `AdminSettingsPage` uses for a single document elsewhere in the codebase. No hand-rolled form.
- Per-locale **Import** (file picker → `POST .../import/:locale`, shows the returned counts) and
  **Export** (`GET .../catalog/:locale` → downloads `<project>.<locale>.json`).
- `translation_messages` is not edited directly here (only through import) — it remains reachable
  generically at `/admin/collections/translation_messages` for direct inspection.

Ordinary collection CRUD (`/admin/collections`, `/admin/collections/:slug`) and the API reference page
are copied from `apps/demo-aesthetics`'s admin pages nearly verbatim — this is the established,
app-local boilerplate pattern in this repo (see `apps/demo-aesthetics`'s "gaps stay as app-side
workarounds" discipline in `docs/DEMO-FINDINGS.md`), not something new invented for this feature.

### Deploy

`apps/demo-i18n` runs on `InMemoryDatabaseAdapter`/`InMemoryStorageAdapter` only in this iteration —
no `wrangler.toml`, no D1/R2 binding, no `deploy:demo-i18n` script. Provisioning real Cloudflare
resources is an action with a blast radius outside a code change, and remote deployment/publishing is
an explicit non-goal of this spec; wiring D1/R2 the same way `apps/demo-aesthetics` does is
mechanical and can happen in its own change when the maintainer is ready to actually deploy this app.

## Implementation plan

- [x] `packages/runtime`: `FieldDescription.localized`, `CollectionDescription.locales`,
      `?locale=` on list/read (already done previously) **and** create/update (this spec's addition)
- [x] `packages/angular`: `FieldMeta.localized`, `CollectionMeta.locales`, `QueryOptions.locale`,
      locale option on `getDocument`/`createDocument`/`updateDocument`
- [x] `packages/admin`: locale tabs in `ForgeFieldControlComponent`, `locales` input on
      `ForgeCollectionFormComponent` — no changes to `config.ts`/`layout.component.ts`
- [x] `apps/www`: wire `[locales]` into `collection-detail.page.ts`
- [x] `apps/demo-i18n`: scaffold (package.json, vite/tsconfig, Analog app shell, login, generic
      admin pages copied from `apps/demo-aesthetics`)
- [x] `apps/demo-i18n`: `translation_projects`/`translation_messages` collections + hooks
- [x] `apps/demo-i18n`: `catalog-utils.ts` (flatten/unflatten/validate) + unit tests
- [x] `apps/demo-i18n`: `import-service.ts`/`export-service.ts` + integration tests against the real
      collections/hooks
- [x] `apps/demo-i18n`: HTTP routes for import/export, generic CRUD routes, auth, status
- [x] `apps/demo-i18n`: bespoke `translations.page.ts` admin page
- [x] Moved the app out of this repository before committing (see the note under Affected apps) —
      root `package.json` carries no `demo-i18n` scripts
- [x] Changeset for the `packages/*` changes
- [x] Manual walkthrough of the full acceptance-criteria workflow in a real browser (Playwright)
- [x] `docs/STATE.md`, `docs/ROADMAP.md`

## Test plan

- Unit: flatten/unflatten (nesting, empty namespaces, invalid leaves, unicode/placeholder
  preservation, deterministic ordering), key validation, locale validation, project-locales
  validation — `catalog-utils.test.ts`.
- Integration (real collections + hooks, not a re-declared schema): new-message import, update-one-
  locale-preserve-others, unchanged-value counting, never-delete-on-import, unknown
  project/locale rejection, per-key error reporting, deterministic export, `fallback: 'none'`
  vs `'source'`, two-project locale isolation, `beforeChange` rejecting bad `locales`/`sourceLocale`/
  duplicate slug/duplicate `(project, key)`/malformed key/out-of-set locale/non-string value, and
  relation `onDelete: 'cascade'` actually deleting a project's messages — `translations.test.ts`.
- Manual/E2E: logged into `/admin`, created "Volt UI" (en/es/uk) leaving slug blank (verified
  server-side auto-generation), imported `en.json` (created: 3), imported `es.json` and `uk.json`
  (updated: 3 each, confirming other-locale preservation), exported `es` and diffed the downloaded
  file against the expected nested structure — byte-for-byte match, alphabetical key order. Run via
  Playwright against the real `pnpm dev` server, not a component harness.
- Quality gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` across the whole monorepo.

## Acceptance criteria

1. `translation_projects`/`translation_messages` exist only in `apps/demo-i18n`; `packages/*` contain
   no translation-specific code.
2. `packages/admin/src/config.ts` (`DEFAULT_ADMIN_NAV`) is unchanged by this spec.
3. Creating a project with `sourceLocale`/`locales` validates both; an invalid combination is rejected.
4. Importing a nested JSON catalog creates one message per flattened key.
5. Importing a second locale updates existing records without touching other locales' values.
6. A key missing from a new import is never deleted.
7. Exporting a locale recreates the nested catalog with deterministic key order.
8. Two projects with different locale sets coexist with no leakage.
9. `(project, key)` duplicates are rejected even through the generic Local API/HTTP CRUD path, not
   only through the import service.
10. `FieldDescription.localized`/`CollectionDescription.locales` propagate to the Angular client, and
    `?locale=` works on read **and** write HTTP paths.
11. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all green.

## Open questions

None.

## Outcome

Shipped 2026-08-22, in two parts.

**Committed to this repository:** the generic localization-propagation fix only —
`FieldDescription.localized`/`CollectionDescription.locales` in `describe.ts`, `?locale=` on all four
HTTP verbs (list/read already had it; this adds create/update), the matching Angular
types/query/`CmsApiService` changes, `ForgeFieldControlComponent`'s locale-tab picker, and
`ForgeCollectionFormComponent`'s `locales` input wired into `apps/www`. `packages/admin`'s shared nav
config is untouched. No new app, no new collections, no translation-specific code anywhere in
`packages/*` or `apps/*`.

**Not committed — moved to `../forgecms-i18n-catalogs-reference`:** the translation-catalog-management
app that validated the design (`translation_projects`/`translation_messages` with `beforeChange`
hooks enforcing `(project, key)` compound uniqueness — tested through the generic Local API create
path, not only the import service's own upsert logic — `catalog-utils`/`import-service`/
`export-service`, the bespoke HTTP routes, and one bespoke admin page). It was fully verified before
the move: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green (69 tests), and the full
workflow (login → create project → import en/es/uk → export es) walked through in a real browser
against a running `pnpm dev` server with Playwright — see that project's own README for its status
and how to reconnect it to `@forge-cms/*` once there is somewhere for it to live.
