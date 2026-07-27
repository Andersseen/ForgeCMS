# DEMO-FINDINGS — what building a real site on ForgeCMS actually cost

> **Date: 2026-07-27.** Source: [`apps/demo-aesthetics`](../apps/demo-aesthetics), a marketing site
> for a fictional skin clinic, built against ForgeCMS as of spec 022 (Phase 1 complete). Spec:
> [039](specs/039-real-world-demo-app.md).
>
> **Rule of the exercise:** while the demo was being built, the app was allowed to work around
> anything, but **no file under `packages/*` was changed** — so every gap stayed visible instead of
> quietly disappearing into the CMS. Each finding is marked `FINDING n` in the code it bit.
>
> **Then the findings were acted on.** Specs [040](specs/040-core-fixes-from-demo-findings.md),
> [041](specs/041-client-query-api.md) and [042](specs/042-admin-field-widgets-and-list-view.md) —
> in the same branch, immediately after — fixed 12 of the 22, and the demo deleted the corresponding
> workarounds. Fixed items are marked ✅ below with what closed them; the workaround code they
> describe is gone from the app, so read those entries as history plus a pointer to the fix.

## Summary

The core held up. Eleven collections, drafts, function-based access, the full hook pipeline,
composite fields and the Local API all did what the docs claim, first time — 18 content-model tests
covering them passed with no changes to any package. The bill came almost entirely from **the edges**:
the client SDK, the admin's field widgets, and the small amount of plumbing every real app needs
(serving an uploaded file, sending an email, rendering richtext).

Put differently: **ForgeCMS is a good CMS core with no delivery layer around it.** The single
highest-value thing this exercise turned up is not on the roadmap as a numbered item at all — it is
that `@forge-cms/angular` cannot express a filtered, sorted, paginated, draft-aware query, so every
consumer falls back to `fetch`.

| #          | Finding                                                             | Bit us in                 | Roadmap         |
| ---------- | ------------------------------------------------------------------- | ------------------------- | --------------- |
| [15](#f15) | The client SDK cannot filter, sort, limit, paginate or set depth    | every page of the site    | ✅ 041          |
| [17](#f17) | The admin cannot see drafts — the client has no `status`            | the editor screen         | ✅ 041 + 042    |
| [9](#f9)   | `depth: 1` does not populate `upload` fields                        | every image on the site   | ✅ 040          |
| [21](#f21) | Uploaded files are stored but never served                          | the media library         | ✅ 040          |
| [8](#f8)   | The Local API returns `Record<string, unknown>` — inference stops   | every server route        | 038             |
| [5](#f5)   | A route's `allowedRoles` pre-empts the collection's own access rule | the public booking form   | ⚠️ documented   |
| [19](#f19) | Hooks cannot tell a trusted server call from a public request       | the seed, silently        | ✅ 040          |
| [4](#f4)   | No globals                                                          | site settings             | 023             |
| [10](#f10) | No `findBySlug`; no "relation contains id" filter                   | every `/:slug` page       | 026             |
| [7](#f7)   | `richtext` has no editor and no renderer                            | journal + treatment copy  | ✅ 042 (editor) |
| [16](#f16) | `blocks` rows are untyped at the render site                        | the home page             | 038             |
| [1](#f1)   | Field options that nothing reads (`autoGenerate`, `defaultValue`)   | 5 collections             | ✅ 040          |
| [18](#f18) | No upload method in the client SDK                                  | the media library         | ✅ 041          |
| [6](#f6)   | No email adapter, so a booking notifies nobody                      | the booking hook          | 029             |
| [11](#f11) | No h3/Nitro helpers — auth routes are copy-paste                    | 6 route files             | 037             |
| [13](#f13) | The Angular linker plugin must be copied into every app             | app setup                 | 037             |
| [12](#f12) | The auth-token localStorage key is not exported                     | app setup                 | 028             |
| [2](#f2)   | No SSR story for a content site                                     | the whole premise         | 036/037         |
| [3](#f3)   | No money or timezone-aware date handling                            | prices, appointment times | new             |
| [14](#f14) | `R2StorageAdapter` hardcodes the `BUCKET` binding name              | runtime wiring            | ✅ 040          |
| [20](#f20) | The admin sidebar's nav items are hardcoded                         | admin routing             | ✅ 042          |
| [22](#f22) | Adapters disagree about `created_at`/`updated_at`                   | sorting by creation date  | ✅ 040          |

---

## The expensive ones

<a id="f15"></a>

### 15. `CmsApiService` cannot express a real query

`getDocuments(collection)` takes **no arguments beyond the slug**. The HTTP API supports
`where`/`sort`/`order`/`limit`/`offset`/`depth`/`status` — the client exposes none of it. There is
also no signal/`resource()` surface, so every page hand-rolls loading/error state.

- **Cost:** the entire public site talks to purpose-built endpoints via raw `fetch`
  ([`site-api.service.ts`](../apps/demo-aesthetics/src/app/services/site-api.service.ts)), and the
  admin needed a second service ([`admin-api.service.ts`](../apps/demo-aesthetics/src/app/services/admin-api.service.ts))
  just to build query strings. Loading state is a home-grown helper
  ([`async-state.ts`](../apps/demo-aesthetics/src/app/pages/site/async-state.ts)) repeated in seven pages.
- **Why it matters more than it looks:** this is the package that is supposed to be the reason to
  pick ForgeCMS over Payload. Today it is the weakest thing in the repo.
- **Fixed (spec 041).** `QueryOptions` on `getDocuments`/`listDocuments`/`getDocument`, pagination
  metadata, `uploadFile`, `collectionResource`/`documentResource`, and — the quiet one — reads now
  send the auth token, which they never did. The demo deleted `admin-api.service.ts` entirely.

<a id="f17"></a>

### 17. An editor cannot see their own drafts

A list defaults to `published` for everyone, and `getDocuments` cannot send `?status=`. So
`/admin/collections/services` — the screen an editor opens _to finish a draft_ — shows only what is
already live.

- **Workaround:** `AdminApiService.listDocuments(slug, { status: 'all' })`.
- **Also missing:** the list has no `_status` column, so once drafts _are_ loaded they look exactly
  like published rows (`_status` appears nowhere in `@forge-cms/admin` or `@forge-cms/angular`).
- **Fixed (specs 041 + 042).** The client can send `status: 'all'`, the list shows a Draft/Published
  badge, and an editor can publish from the row without opening the document.

<a id="f9"></a>

### 9. `depth: 1` ignores `upload` fields

`populateRecords` filters on `field.kind === 'relation'`. Spec 016 describes `upload` as
"structurally identical to a single relation", but population does not treat it as one — so every
image came back as a bare UUID.

- **Workaround:** [`uploads.ts`](../apps/demo-aesthetics/src/server/api/uploads.ts) — a 30-line
  re-implementation of the batching `populate.ts` already does.
- **Fixed (spec 040).** `populate.ts` resolves `upload` as the single relation it is. The demo's
  `uploads.ts` is gone, and the site's endpoints just pass `depth: 1`.

<a id="f21"></a>

### 21. Uploads are stored and then unreachable

`POST /api/v1/media` (multipart) stores the bytes and writes a `url` onto the document — but no
package serves those bytes, and `InMemoryStorageAdapter.getPublicUrl` returns
`https://forge.test/storage/<key>`, a domain that does not exist. Every locally uploaded image is a
broken link.

- **Workaround:** a catch-all route
  ([`api/media/[...key].get.ts`](../apps/demo-aesthetics/src/server/routes/api/media/%5B...key%5D.get.ts))
  plus a field hook that rewrites the stored URL to point at it.
- **Fixed (spec 040).** `@forge-cms/runtime` exports `handleFile`, and `InMemoryStorageAdapter`
  returns a servable `/api/media/<key>` (with `setPublicUrlBase` to change it).

<a id="f8"></a>

### 8. Type inference stops at the server boundary

`CollectionData<typeof services>` infers a precise record type from the definition, but
`find`/`findByID` return `DatabaseRecord` = `Record<string, unknown>`. Everything past that point is
hand-written.

- **Cost:** [`shared/site-content.ts`](../apps/demo-aesthetics/src/shared/site-content.ts) (150
  lines of interfaces) and [`mappers.ts`](../apps/demo-aesthetics/src/server/api/mappers.ts) (210
  lines of casting) — a fifth of the app's server code exists only to re-state what the collection
  definitions already know.
- **Fix:** roadmap 038. Generic `find<T extends CollectionDefinition>` would cover most of it.

<a id="f5"></a>

### 5. The transport gate runs before the collection's access rule

`handleCreate(context, { allowedRoles: ['admin','editor'] })` is a per-route constant. A collection
whose `access.create` returns `true` for anonymous callers (a booking form, a contact form, a
comment) is still rejected at the transport layer — the generic CRUD route cannot host a public
write for _one_ collection without opening it for _all_ of them.

- **Nuance:** `resolveRequest` does skip `allowedRoles` when the collection declares its own rule
  for that operation, which is what makes the demo's `POST /api/site/bookings` work. But `apps/www`'s
  route shape (a single `[collection].post.ts` with static roles) means the behaviour depends on
  whether a collection happens to declare `access.create` — subtle, and easy to get wrong in the
  unsafe direction.
- **Workaround:** a dedicated endpoint that calls the Local API with `overrideAccess: false, user: null`
  ([`bookings.post.ts`](../apps/demo-aesthetics/src/server/routes/api/site/bookings.post.ts)).
- **Status: documented, not changed.** `resolveRequest` already skips `allowedRoles` when the
  collection declares its own rule, so the behaviour is correct — it is the _implicitness_ that is
  dangerous. Changing the precedence is a security-shaped decision that deserves its own spec rather
  than a drive-by fix.

<a id="f19"></a>

### 19. A hook cannot tell trusted server code from a request off the street

`HookContext` carries `user`, but not `overrideAccess` — the exact flag the operation used to decide
the call was trusted. A `beforeChange` hook that hardens public writes ("force `status` to
`pending`") therefore also fires for a seed script or an admin-triggered server task, where `user` is
`null` for an entirely different reason.

- **How it showed up:** the seeded "confirmed" booking silently came back `pending`. Nothing failed;
  the data was just wrong. Regression test:
  [`content-model.test.ts`](../apps/demo-aesthetics/src/tests/content-model.test.ts) →
  _"cannot tell a trusted seed apart from a public request"_.
- **Workaround:** create, then `update` in a second call (the update path is not hooked the same way).
- **Fixed (spec 040).** `BaseHookArgs`/`FieldHookArgs` carry `overrideAccess`. The demo's booking
  hook now reads it, the seed writes a confirmed booking in one call, and the regression test was
  inverted to lock the new behaviour in.

---

## The structural gaps

<a id="f4"></a>

### 4. No globals

Site settings are a collection expected to hold exactly one row. Nothing enforces it: `POST
/api/v1/site_settings` creates a second one happily, every read is `docs[0]`, and the settings screen
has to decide between create and update by looking for an id
([`settings.page.ts`](../apps/demo-aesthetics/src/app/pages/admin/settings.page.ts)). **Fix:** roadmap 023.

<a id="f10"></a>

### 10. No slug lookup, and no way to query a relation list

Two separate holes in the query layer, both hit on one page
([`services/[slug].get.ts`](../apps/demo-aesthetics/src/server/routes/api/site/services/%5Bslug%5D.get.ts)):

1. `findByID` is the only single-document read, so every `/:slug` page issues a list query with
   `limit: 1` and unwraps `docs[0]`.
2. "staff whose `specialties` contains this service id" is not expressible — `contains` is a string
   operator, and a `many` relation is stored as JSON. The demo loads the whole team and filters in
   JavaScript, which is fine for three people and wrong for three hundred.

**Fix:** roadmap 026, plus a `findOne`/`where`-shorthand.

<a id="f7"></a>

### 7. `richtext` is a type with no editor and no renderer

The kind validates and stores fine, but `@forge-cms/admin` falls back to a textarea (so a JSON tree
must be typed by hand) and there is no renderer for the front end.

- **Workaround:** seed content builds the node tree in code (`paragraphs()` in
  [`seed.ts`](../apps/demo-aesthetics/src/server/api/seed.ts)), and `toParagraphs()` in `mappers.ts`
  flattens it back to plain strings — which throws away every mark the format exists to carry.
- **Half fixed (spec 042).** `ForgeRichTextEditorComponent` edits the tree as text blocks, so nobody
  types JSON any more. **Still open:** no renderer for the front end, so the demo still flattens
  richtext to plain paragraphs.

<a id="f16"></a>

### 16. A `blocks` row is `Record<string, unknown>` at the render site

`BlockValue` is deliberately not a discriminated union, so the page-builder — the feature that
justifies blocks existing — renders through six hand-written cast helpers
([`home.page.ts`](../apps/demo-aesthetics/src/app/pages/site/home.page.ts)). Renaming a field inside a
block definition breaks the template silently.

**Fix:** roadmap 038, or a `blockType`-narrowing helper exported from `@forge-cms/core`.

<a id="f1"></a>

### 1. Declared-but-inert field options

Two options exist in the type system and are read by **nothing** in the entire repo (verified by
grep: the only occurrence of each is its own declaration):

- `defineField.slug({ autoGenerate: true, sourceField: 'name' })` — so all five slug-bearing
  collections re-implement the same `beforeValidate` hook.
- `BaseFieldOptions.defaultValue` — a `select` with `defaultValue: 'pending'` stores nothing at all;
  the demo's defaults only apply because hooks set them.

This is the worst kind of gap: the API _looks_ complete, so you find out at runtime.

- **Fixed (spec 040).** Both are applied in the write pipeline before hooks run, and `slugify` is
  exported from `@forge-cms/core`. Five collections in the demo dropped their hand-written hook.

<a id="f18"></a>

### 18. The client SDK cannot upload

Spec 016 built a real multipart path on the server; `CmsApiService` only ever sends JSON. Any media
library must hand-roll the `FormData` POST. **Fixed (spec 041):** `CmsApiService.uploadFile`, used by
the admin's new media picker.

<a id="f6"></a>

### 6. A booking notifies nobody

There is no email adapter, so the one side effect every booking form needs is a `console.info` in an
`afterChange` hook. **Fix:** roadmap 029 — and it should rank higher than its Phase 3 slot, because
"content site with a form" is the most common thing anyone builds on a CMS.

---

## Setup and plumbing friction

<a id="f11"></a>

### 11. Every app rewrites the same route files

The five CRUD routes, the four auth routes and the `createAuthRequest` body-consumption workaround
were copied from `apps/www` almost verbatim. `@forge-cms/api` contains types and nothing else.
**Fix:** roadmap 037 (`@forge-cms/analog`) — `defineForgeRoutes({ runtime })` should generate them.

<a id="f13"></a>

### 13. The Angular linker plugin must be copied per app

`vite-plugins/angular-linker.ts` is mandatory for any Vite app consuming `@forge-cms/admin` (partial
Ivy), and it ships in `apps/www` rather than in a package. Forgetting it produces a
production-only `JIT compiler unavailable` crash — STATE.md's known issue #10, which is now waiting
to be rediscovered by every new app. **Fix:** export it from `@forge-cms/admin` (or 037).

<a id="f12"></a>

### 12. `'forge-auth-token'` is a magic string

`ForgeAdminLayoutComponent` reads that exact localStorage key, but does not export it, so the host
app hardcodes the same literal in its login page and API client
([`auth-token.ts`](../apps/demo-aesthetics/src/app/auth-token.ts)). **Fix:** export the constant; longer
term, roadmap 028 (httpOnly cookie sessions) removes the question.

<a id="f2"></a>

### 2. No SSR story

A clinic's marketing site lives or dies by search results and link previews; this one ships as an
SPA with an empty `<body>` until JavaScript runs, and `src/main.server.ts` is a stub that exists
only to satisfy the build. `CmsApiService` uses relative-URL `fetch`, which cannot work server-side
anyway.

The Local API makes ForgeCMS _ideally_ placed for SSR — the data is already there with no HTTP hop —
so this is a missed open goal rather than a missing feature. **Fix:** 036 (SSR-safe fetch + transfer
state) and 037.

<a id="f3"></a>

### 3. Money and time are `number` and `string`

- No currency field kind: prices are `number`, and a `beforeChange` hook rounds to two decimals to
  stop floats leaking in. Currency itself is not modelled anywhere.
- `date` has `withTime`, but the value is stored exactly as sent: the booking form's
  `datetime-local` value (`2026-08-12T17:00`, no zone) is stored verbatim. For an appointments
  system that is a genuine correctness problem the moment staff and client are in different zones.

**Fix:** a `currency` kind (amount + code) and normalisation-to-UTC on `date`.

<a id="f14"></a>

### 14. The R2 binding name is fixed by the adapter

`R2StorageAdapter.init` reads `env.BUCKET` and throws otherwise, so a project with two buckets — or
one called `MEDIA` — cannot use it. `D1DatabaseAdapter` has the same shape for `DB`. **Fixed (spec 040):** exactly that, plus `publicUrlBase`, and the same for `D1DatabaseAdapter`.

<a id="f20"></a>

### 20. The admin's nav is hardcoded

`ForgeAdminConfig` can set the sidebar title (reachable, via route `data` +
`withComponentInputBinding()` — see [`app.routes.ts`](../apps/demo-aesthetics/src/app/app.routes.ts)),
but the nav items are fixed in the layout: `Dashboard`, `Collections`, `Media Library`, `Users`,
`API Keys`, `Settings`. Every consuming app must implement all six routes or ship dead links — this
demo implemented all six for that reason. A clinic would want "Bookings" first.

- **Fixed (spec 042).** `ForgeAdminConfig.nav` takes groups of items (with `adminOnly`), defaulting
  to `DEFAULT_ADMIN_NAV`. The demo's sidebar now opens on Bookings.

<a id="f22"></a>

### 22. Adapters disagree about timestamps

`LibSqlDatabaseAdapter` and `D1DatabaseAdapter` set `created_at`/`updated_at` on every write.
`InMemoryDatabaseAdapter` sets neither, and the contract suite never asserts them — so "newest
first" works in production and silently returns arbitrary order in local development. The demo sorts
by explicit content fields (`publishedAt`, `order`) to dodge it. **Fixed (spec 040):** the in-memory
adapter stamps both, and the contract suite asserts it — as it now also asserts that `contains` is
case-insensitive, another divergence found while building the relation picker.

---

## What worked well (worth protecting)

- **The Local API is the real thing.** Composing five collections into one payload in
  [`home.get.ts`](../apps/demo-aesthetics/src/server/routes/api/site/home.get.ts), with access rules
  and draft filtering applied, is genuinely nicer than any REST-first CMS. The roadmap thesis holds.
- **Access control as functions** paid off immediately: "staff see the inbox, a client sees only
  their own bookings, anonymous sees nothing" is nine lines, and it narrows `totalDocs` too. The
  404-instead-of-403 choice for unreachable single reads is right.
- **Drafts** behaved exactly as specified on the public site with no app-side code at all.
- **Composite fields** round-tripped through the API and rendered recursively in the admin form (41
  labelled inputs for the settings document) without a single fix.
- **Field-level access** kept `internalNotes` out of client reads by construction.
- **The error envelope and status codes** are consistent, including the deliberate
  `AccessDenied + anonymous → 401` mapping, which is the correct choice.

## What was done about it

Specs 040, 041 and 042 landed in this branch straight after the demo, closing 12 findings:

| Spec | Closed                                               | Effect on the demo                                                                                              |
| ---- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 040  | 1, 9, 14, 19, 21, 22 (+ case-insensitive `contains`) | Deleted `uploads.ts`, five slug hooks, a URL-rewrite hook, a file-serving route and a two-step seed workaround. |
| 041  | 15, 17 (client half), 18                             | Deleted `admin-api.service.ts`; the admin talks to the package.                                                 |
| 042  | 7 (editor half), 16 (partly), 17, 20                 | No UUIDs or `[object Object]` in the admin; publish from the list; the clinic's own sidebar.                    |

**Still open, in the order they should be taken:**

1. **036's other half — SSR** (finding 2). The Local API makes ForgeCMS ideally placed for it and the
   demo still ships as an SPA.
2. **038 typed documents** (findings 8, 16). The demo still hand-writes 350 lines of payload types
   and casts every block at the render site.
3. **023 globals** (finding 4) and **026 query completeness** (finding 10) — `findBySlug` and
   "relation contains id" are both still worked around in the demo's route files.
4. **029 email** (finding 6). A booking form that notifies nobody is not finished.
5. **037 framework integration** (findings 11, 13) — the route files and the Angular linker plugin
   are still copied per app.
6. **A richtext renderer** (rest of finding 7) and **currency/timezone types** (finding 3).
7. **The `allowedRoles` precedence** (finding 5) — correct today, but implicit enough to be worth a
   spec of its own.
