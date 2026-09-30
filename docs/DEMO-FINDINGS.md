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
>
> **Re-dogfooded 2026-09-28 against ForgeCMS 0.7** ([spec 071](specs/071-0.7-consolidation-and-dogfood-refresh.md)).
> Several fixes had shipped in the packages while the demo kept its workaround (8, 10, 12, 15). Those
> workarounds are now gone. The pass found one new item (24), added 23 to the summary table, and found
> three admin package defects, fixed in the same spec. See [0.7 status](#status-07) for the current
> table; the per-finding text below stays as originally written, with dated status lines added.

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

| #          | Finding                                                             | Bit us in                 | Roadmap                                                        |
| ---------- | ------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------- |
| [15](#f15) | The client SDK cannot filter, sort, limit, paginate or set depth    | every page of the site    | ✅ 041                                                         |
| [17](#f17) | The admin cannot see drafts — the client has no `status`            | the editor screen         | ✅ 041 + 042                                                   |
| [9](#f9)   | `depth: 1` does not populate `upload` fields                        | every image on the site   | ✅ 040                                                         |
| [21](#f21) | Uploaded files are stored but never served                          | the media library         | ✅ 040                                                         |
| [8](#f8)   | The Local API returns `Record<string, unknown>` — inference stops   | every server route        | ✅ 047; demo migrated 071                                      |
| [5](#f5)   | A route's `allowedRoles` pre-empts the collection's own access rule | the public booking form   | ⚠️ documented                                                  |
| [19](#f19) | Hooks cannot tell a trusted server call from a public request       | the seed, silently        | ✅ 040                                                         |
| [4](#f4)   | No globals                                                          | site settings             | ✅ 066 (package); demo retained (M02 exists; prod run pending) |
| [10](#f10) | No `findBySlug`; no "relation contains id" filter                   | every `/:slug` page       | ✅ 050; demo migrated 071                                      |
| [7](#f7)   | `richtext` has no editor and no renderer                            | journal + treatment copy  | ✅ 042 (editor)                                                |
| [16](#f16) | `blocks` rows are untyped at the render site                        | the home page             | 038                                                            |
| [1](#f1)   | Field options that nothing reads (`autoGenerate`, `defaultValue`)   | 5 collections             | ✅ 040                                                         |
| [18](#f18) | No upload method in the client SDK                                  | the media library         | ✅ 041                                                         |
| [6](#f6)   | No email adapter, so a booking notifies nobody                      | the booking hook          | 029                                                            |
| [11](#f11) | No h3/Nitro helpers — auth routes are copy-paste                    | 6 route files             | 037                                                            |
| [13](#f13) | The Angular linker plugin must be copied into every app             | app setup                 | ✅ 055                                                         |
| [12](#f12) | The auth-token localStorage key is not exported                     | app setup                 | ✅ 054; demo migrated 071                                      |
| [2](#f2)   | No SSR story for a content site                                     | the whole premise         | 036/037                                                        |
| [3](#f3)   | No money or timezone-aware date handling                            | prices, appointment times | new                                                            |
| [14](#f14) | `R2StorageAdapter` hardcodes the `BUCKET` binding name              | runtime wiring            | ✅ 040                                                         |
| [20](#f20) | The admin sidebar's nav items are hardcoded                         | admin routing             | ✅ 042                                                         |
| [22](#f22) | Adapters disagree about `created_at`/`updated_at`                   | sorting by creation date  | ✅ 040                                                         |
| [23](#f23) | A hook cannot query the CMS                                         | the demo's limit hooks    | open                                                           |
| [24](#f24) | `date` is typed `Date` but travels as a string                      | journal, promotions, form | open → 0.8 C02                                                 |

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
- **Status 2026-09-28 (spec 071):** the public site still uses `/api/site/*` rather than the SDK,
  and that is now a **decision, not a workaround**. Each page needs several collections. The server
  composes them on the Local API as an anonymous visitor, so the browser makes one request and gets a
  small view model. The stale "the SDK cannot filter" comments are gone. The admin now uses the
  package's own content routes (`forgeAdminContentRoutes()`), so its last hand-written list page is
  gone too.

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

**Fixed at the package level, spec 047 (2026-08-27).** `ForgeCmsRuntime<TEnv, TCollections>` now
preserves the registered collection schemas, so `find`/`findByID`/`findOne`/`create`/`update`/
`delete`/`preview` infer typed collection slugs and typed returned documents (declared fields plus
`id`/`created_at`/`updated_at`) instead of `Record<string, unknown>` — exactly the generic
`find<T extends CollectionDefinition>` this finding asked for, proven through the packed public
surface by `scripts/verify-release.mjs`. `apps/demo-aesthetics` itself was not migrated (out of
scope for spec 047, and this app is frozen at "zero changes to packages/\*" per its own charter), so
its own `shared/site-content.ts`/`mappers.ts` hand-written types remain as they were — this finding's
_cost_ is unchanged in this app specifically, but the _capability_ that removes it for any new
consumer now exists. See [docs/specs/047-typed-local-api.md](specs/047-typed-local-api.md).

**Status 2026-09-28 (spec 071): migrated.** The demo's runtime is `ForgeCmsRuntime<ServerEnv,
DemoCollections>`, the seed and every site route compile against the content model, and `mappers.ts`
takes `CollectionDocument<typeof services>` etc. `shared/site-content.ts` stays hand-written on
purpose: it is the browser's view model (richtext flattened, relations resolved, internal fields
left out), not a copy of the documents. **Remaining limits:** a populated relation/upload is still
typed as its id, `date` is typed `Date` for writes and reads (finding 24), and browser-side types
from the schema are roadmap 0.8 (C02). Typing also caught one app bug: writing
`withAuthFields(defineCollection({ … }))` inline widens the users slug to `string`, which let the
typed registry accept any collection name. Defining the collection first keeps the literal (as the
docs already show).

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

**Status 2026-09-28 (spec 071): fixed in the package, deliberately retained in the demo.** Globals
exist (`defineGlobal`, `getGlobalDocument`/`updateGlobalDocument`, `GET/PUT /api/v1/globals/:slug`;
certified by spec 066). The deployed demo, however, has a persistent D1 whose `site_settings` table
holds the settings editors have changed. A global is stored in a new `_global_site_settings` table.
Schema sync would create it safely (M01 classifies it as additive), but **empty**, so the site would
lose its phone, address and hours until someone re-entered them. Copying the row is a data migration.
Reviewed migrations exist since spec 072 (M02), but running one against the deployed D1 is a
production operation that needs a backup first; it has not been done. The demo keeps the collection
until then. Reads now use
`findOne`; nothing still prevents a second row.

<a id="f10"></a>

### 10. No slug lookup, and no way to query a relation list

Two separate holes in the query layer, both hit on one page
([`services/[slug].get.ts`](../apps/demo-aesthetics/src/server/routes/api/site/services/%5Bslug%5D.get.ts)):

1. `findByID` is the only single-document read, so every `/:slug` page issues a list query with
   `limit: 1` and unwraps `docs[0]`.
2. "staff whose `specialties` contains this service id" is not expressible — `contains` is a string
   operator, and a `many` relation is stored as JSON. The demo loads the whole team and filters in
   JavaScript, which is fine for three people and wrong for three hundred.

**Fix:** roadmap 026, plus a `findOne`/`where`-shorthand — **done at the package level, spec 050,
2026-08-30**: `runtime.findOne({ collection, where })` replaces the `find({ where, limit: 1 }).docs[0]`
pattern, and `where: { specialties: { containsValue: staffId } }` (a new `containsValue` operator,
valid on `relation` fields) replaces "load everything and filter in JavaScript" with a real
database-side filter on every adapter. **The demo app's route file itself was deliberately not
touched** — spec 050 was scoped to the core query layer only, not to migrating existing consumer
code; `services/[slug].get.ts` still uses its original workaround, and updating it to use the new
primitives is a follow-up, not part of this fix.

**Status 2026-09-28 (spec 071): migrated.** `server/api/service-detail.ts` uses `findOne` by slug and
`where: { active: true, specialties: { containsValue: id } }`, so the database does the filtering.
`content-model.test.ts` proves the result equals the old load-everything filter, and that unknown and
draft slugs return `null` (a 404). The journal, home and settings routes use `findOne` too. The
staff query now passes `depth: 1`: the page always rendered specialist photos, but without
population they were ids, so no photo ever showed.

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
**Update (spec 053, 2026-09-02):** `apps/www` gained its own `requireAdminAuth()` (matching the one
`apps/demo-aesthetics` already had) to add a CSRF check in one place instead of four — reduces
duplication _within_ `apps/www`, but the two apps still maintain independent copies of the same
pattern; this finding's actual fix (a generated/shared route layer) is unchanged.

<a id="f13"></a>

### 13. The Angular linker plugin must be copied per app

~~`vite-plugins/angular-linker.ts` is mandatory for any Vite app consuming `@forge-cms/admin` (partial
Ivy), and it ships in `apps/www` rather than in a package.~~ **Fixed, spec 055 (2026-09-03).**
`@forge-cms/admin` now exports the plugin from a `./vite` subpath
(`import { angularLinker } from '@forge-cms/admin/vite'`, `packages/admin/src/vite-linker.ts`);
`@angular/compiler-cli`/`@babel/core`/`vite` are optional peer dependencies (only needed if a
consumer actually imports this subpath). `apps/www` and `apps/demo-aesthetics` both dropped their
local `vite-plugins/angular-linker.ts` copy in favor of the shared export, proving it in place, not
just in isolation.

<a id="f12"></a>

### 12. `'forge-auth-token'` is a magic string

~~`ForgeAdminLayoutComponent` reads that exact localStorage key, but does not export it~~. **Fixed,
spec 054 (2026-09-03).** `@forge-cms/angular`'s `CmsApiService` now sends `credentials: 'include'` on
every request and the browser session lives in `ForgeAuthSession` (signals, no storage); `@forge-cms/admin`'s
`ForgeAdminLayoutComponent` reads that service instead of `localStorage`. This app's own
`auth-token.ts` (the file this finding originally pointed at) is gone — its `login.post.ts`/
`me.get.ts` were brought onto `handleLogin`/`handleMe` in the same spec, so there is no longer a
magic string to export: the question this finding raised (a bearer-token key shared between two
files) does not apply to the cookie-based session at all.

**Correction 2026-09-28 (spec 071):** the paragraph above was wrong about this app. `auth-token.ts`
still existed. `login.page.ts` stored the login token in `localStorage`, and `provideForgeCms({ authToken })`
sent it as a Bearer on every request. Because `handleLogout` can only clear the cookie (bearer tokens
are stateless, spec 053), **"Log out" left the admin signed in** through the stored token, and
`/admin` had no guard. Now `auth-token.ts` is deleted and the login page uses `ForgeAuthSession`
(cookie only). `/admin` is guarded by `forgeAuthGuard({ signInPath: '/login' })`, and an E2E test
proves that after logout `/api/auth/me` is 401 and `/admin` redirects to sign-in.

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
**2026-09-28:** the demo's `runtime.ts` comment still called the name "fixed by the adapter"; it now
says the app keeps `DB`/`BUCKET` because the deployed Pages project is bound under those names.

<a id="f20"></a>

### 20. The admin's nav is hardcoded

`ForgeAdminConfig` can set the sidebar title (reachable, via route `data` +
`withComponentInputBinding()` — see [`app.routes.ts`](../apps/demo-aesthetics/src/app/app.routes.ts)),
but the nav items are fixed in the layout: `Dashboard`, `Collections`, `Media Library`, `Users`,
`API Keys`, `Settings`. Every consuming app must implement all six routes or ship dead links — this
demo implemented all six for that reason. A clinic would want "Bookings" first.

- **Fixed (spec 042).** `ForgeAdminConfig.nav` takes groups of items (with `adminOnly`), defaulting
  to `DEFAULT_ADMIN_NAV`. The demo's sidebar now opens on Bookings.

<a id="f23"></a>

### 23. A hook cannot query the CMS

Hook args carry `data`, `doc`, `user`, `operation` and (since spec 040) `overrideAccess` — but no
handle on the CMS. Any rule that has to _look something up_ is stuck: "refuse this delete if it would
leave fewer than six services", "reject a slug that already exists", "do not remove the last admin".

- **Workaround:** the demo keeps a module-level runtime reference
  ([`runtime-ref.ts`](../apps/demo-aesthetics/src/server/api/runtime-ref.ts)) purely so its limit
  hooks can call `count()` and `find()`. It also has to live in its own module to avoid an import
  cycle, which is a good sign the shape is wrong.
- **Fix:** pass the `OperationContext` that `operations.ts` already holds into hook args, the way
  Payload passes `req` with its instance.

<a id="f22"></a>

### 22. Adapters disagree about timestamps

`LibSqlDatabaseAdapter` and `D1DatabaseAdapter` set `created_at`/`updated_at` on every write.
`InMemoryDatabaseAdapter` sets neither, and the contract suite never asserts them — so "newest
first" works in production and silently returns arbitrary order in local development. The demo sorts
by explicit content fields (`publishedAt`, `order`) to dodge it. **Fixed (spec 040):** the in-memory
adapter stamps both, and the contract suite asserts it — as it now also asserts that `contains` is
case-insensitive, another divergence found while building the relation picker.

---

<a id="f24"></a>

### 24. `date` is typed `Date` but travels as a string (found 2026-09-28, spec 071)

Typing the demo's runtime (finding 8) exposed a mismatch the untyped API hid:

- `defineField.date()` infers `Date`, so a typed `create`/`update` rejects the ISO strings that the
  validator accepts and that every HTTP client sends;
- the SQL adapters (libSQL, D1) return a `Date` on read (`fromDbValue`), while the in-memory adapter
  returns whatever was written — usually a string;
- the demo's mappers used `str(record.publishedAt)`. Against D1, that turned every journal date and
  promotion end date into `''`. Local development (in-memory) looked fine.

**Workaround (marked `FINDING 24`):** the mappers convert `Date | string` with `isoDate()`. The seed
writes through the untyped runtime view, and the booking route casts the visitor's zone-less value.
**Fix:** a wire-type decision for dates (input `Date | string`, one read representation across
adapters). That belongs to roadmap 0.8 C02 (schema-aware wire types). It changes public types and
adapter output, so it was recorded rather than patched in a consolidation pass.

<a id="status-07"></a>

## 0.7 status (2026-09-28, spec 071)

| #   | Original finding                    | Package fix | Demo status                                                                                    | Remaining limit                                     |
| --- | ----------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 4   | No globals                          | 023 / 066   | **Retained**: persistent D1 row would need a data migration                                    | Back up, then migrate to `defineGlobal` via M02     |
| 8   | Local API untyped                   | 047         | **Migrated**: typed runtime, typed mapper inputs                                               | Populated relations typed as ids; browser types C02 |
| 10  | No slug lookup / relation filter    | 050         | **Migrated**: `findOne` + `containsValue`, regression tests                                    | —                                                   |
| 12  | Auth token in `localStorage`        | 054         | **Migrated**: cookie session, guard; fixed a logout that kept you in                           | —                                                   |
| 14  | Fixed binding names                 | 040         | **Comment only**: names kept for the deployed bindings                                         | —                                                   |
| 15  | SDK cannot query                    | 041         | **Rationale rewritten**: `/api/site/*` kept as the recommended design; admin on package routes | —                                                   |
| 23  | Hooks cannot query the CMS          | —           | Workaround kept (`runtime-ref.ts`)                                                             | Needs an operation handle in hook args              |
| 24  | `date` typed `Date`, sent as string | —           | Workaround kept (`isoDate`, one cast)                                                          | 0.8 C02                                             |

Admin package defects found by moving the demo onto `forgeAdminContentRoutes()` and fixed in spec 071
(patch changeset):

- the list never requested `depth: 1`, so relation and upload cells were truncated ids;
- wide lists widened the whole page on phones (the rows' `sr-only` labels escaped the scroller);
- the sidebar and theme toggles, and every boolean switch, had no accessible name.

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
| 047  | 8 (package level)                                    | Typed Local API exists for any new consumer; this app itself was not migrated (out of scope).                   |
| 054  | 12                                                   | Client is cookie-only now (`credentials: 'include'`) — no `localStorage` auth-token question left to answer.    |
| 055  | 13                                                   | `@forge-cms/admin/vite` exports the linker plugin; both `apps/www` and this app dropped their local copy.       |

**Still open, in the order they should be taken** (updated 2026-09-28, spec 071 — globals, query
completeness, typed Local API and the linker plugin have shipped and are no longer listed):

1. **SSR** (finding 2) — roadmap 0.9. The Local API makes ForgeCMS ideally placed for it and the demo
   still ships as an SPA.
2. **Schema-aware wire types** — roadmap 0.8 C02: `date` representation (finding 24), populated
   relation types (rest of finding 8), and typed `blocks` rows (finding 16).
3. **Moving the demo's settings to a real global** (finding 4). The mechanism exists since M02
   (spec 072) and the backup/restore runbook since M03 ([BACKUP-RESTORE](BACKUP-RESTORE.md), spec
   073); what remains is the backed-up production run itself.
4. **Email** (finding 6). A booking form that notifies nobody is not finished. Post-1.0 per the
   roadmap, but it is the gap every content site hits first.
5. **Hook access to the CMS** (finding 23) — pass the operation context into hook args.
6. **Framework route integration** (finding 11) — the route files are still copied per app.
7. **A richtext renderer** (rest of finding 7) and **currency/timezone types** (finding 3).
8. **The `allowedRoles` precedence** (finding 5) — correct today, but implicit enough to be worth a
   spec of its own.
