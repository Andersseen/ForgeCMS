# 080 — Safe public hydration and transfer behavior

- **Status:** done (implemented and verified on the branch; merge pending)
- **Author:** agent draft (implementation requested by the maintainer, 2026-10-07 — "spec 080 — roadmap
  0.9 / S02"; per [SDD.md](../SDD.md) an explicit request to implement counts as approval)
- **Date:** 2026-10-07
- **Branch:** feature/spec-080-safe-public-hydration-transfer
- **Affected packages/apps:** @forge-cms/angular (resources, new internal transfer module), apps/tiny-project
  (hydration + opted-in public pages), scripts (packed SSR consumer gains a browser journey), CI, apps/www
  (SSR guide), docs

## Context / Why

Roadmap 0.9 / S02 ([0.9-ssr.md](../roadmap/v1/0.9-ssr.md)), after S01 ([spec 078](078-request-scoped-server-transport.md)).
S01 renders public content on the server but deliberately lets the browser fetch it again after bootstrap
(and replace the server DOM). S02 lets an **explicitly public** read hydrate from the server's exact result,
without ever serializing anything personal.

## Framework evidence (inspected 2026-10-07 from the installed sources)

| Package                     | Version | Fact used                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@angular/core`             | 21.2.10 | `TransferState` (`get`/`set`/`remove`/`hasKey`/`toJson`) and `makeStateKey` live in core; the root factory reads `<script id="{APP_ID}-state" type="application/json">` once, only when not on the server. `toJson()` is `JSON.stringify(store)` with `<` → `<` and `/` → `/`, so `</script>` cannot occur.             |
| `@angular/platform-server`  | 21.2.10 | `provideServerRendering()` registers a `BEFORE_APP_SERIALIZED` hook that writes that script (skipped when the store is empty). `renderApplication` waits for `whenStable()` first, so state set by a request held in `PendingTasks` (S01) is serialized.                                                                |
| `@angular/platform-browser` | 21.2.10 | `provideClientHydration(...features)` = DOM hydration + (by default) an `HttpClient` transfer cache. Forge does not use `HttpClient`, so the app passes `withNoHttpTransferCache()`. Event replay is not relevant (no event-dependent public content) and is not enabled. Hydrated elements lose their `ngh` attribute. |
| `@analogjs/platform`        | 2.5.2   | Client entry is the app's own `main.ts` (`bootstrapApplication`); the server entry is S01's `renderApplication` call. No Analog-specific hydration API is needed; `provideClientHydration` belongs in the shared `app.config.ts`.                                                                                       |

Forge keeps its own fetch transport and resources; nothing here touches `HttpClient` or raw transport.

## Goal

An explicitly public Forge resource successfully rendered on the server can hydrate the browser from that
exact public result without repeating its initial network read, while authenticated/personalized data,
credentials, failures and unrelated requests are never serialized or reused. This is public response
transfer, not a universal cache.

## Non-goals

`ForgeAuthSession`/`/me`/users/login transfer (never); transfer at the raw transport or for every
`CmsApiService` GET; persistent or cross-request caches; TTL/stale-while-revalidate; Local API output
bridging; event replay/incremental hydration; S03's production CMS journey; S3/portable storage; the
`@forge-cms/db` libSQL packaging finding (unchanged, still worked around only in the packed consumer).

## Design

### API (additive)

```ts
collectionResource(() => ({ collection: 'posts', limit: 10 }), { transfer: 'public' });
documentResource(() => ({ collection: 'posts', id: this.id() }), { transfer: 'public' });
// export interface ForgeResourceOptions { transfer?: 'public' }
```

No option → exactly the previous behavior, nothing transferred. It is integrated in `createResource`
(request key, credential revision, abort and commit guard already live there); no second abstraction.

### Eligibility — anonymous by construction

`CmsApiService` records, at construction, whether it is anonymous: `credentials === 'omit'` **and** no
`authToken` (string or function) **and** (browser, or the render's server context reports
`forwardsAuthorization === false`). A `credentials: 'omit'` client never receives forwarded cookies (S01).
Creating a resource with `{ transfer: 'public' }` on any other client **throws a `TypeError`** (same rule
on server and browser, so a misconfiguration fails in development, not only in production). Test doubles
that never registered a policy are ineligible. A custom `transport` that adds its own identity is outside
the contract and documented as such. `ForgeAuthSession`, `/me`, users, login/logout, previews and
`CmsApiService` itself never transfer anything.

### Transfer key

`forge:public:` + `JSON.stringify([namespace, kind, requestKey])`, where `namespace` is the **configured**
content base (`/api/v1` — never S01's resolved absolute origin, so server and browser agree), `kind` is
`collection`/`document`, and `requestKey` is C03's canonical key (`collection + buildQueryString(query)`,
`[collection, id, depth]`) — covering collection, id, page/offset/limit, sort, where, depth, locale and
draft options. No cookie, token, user, revision object or secret is part of it. Two configured bases never
collide because the base is in the key.

### Lifetime (not a cache)

- **Server:** after a _successful, current_ attempt, the value (the exact `PaginatedDocuments<T>` /
  document the resource exposes) is `set` in that render's `TransferState`. Errors, aborted and superseded
  attempts write nothing. There is no module-global map; each render has its own `TransferState`.
- **Browser:** a root `ForgePublicTransfer` opens a hydration window when first created while the
  application is not yet stable and closes it at the first `whenStable()`, removing every `forge:public:`
  entry from the store. A resource captures "hydrating" at creation and may use transferred state only for
  its **first request**; every identical resource in that window reads the same entry (no
  consume-and-delete race). A first transfer resource created on an already-stable app finds the window
  closed.
- **After the first request:** `reload()`, key changes (page/sort/where/depth/locale/id), route changes,
  credential changes and a full page load all behave exactly as C03 specifies — real reads. A transferred
  value is committed as if that request had just succeeded, so abort/staleness/credential semantics are
  untouched.

### Failure

An SSR failure renders the normal resource error state and writes nothing; the browser starts with no
transferred value, fetches normally after bootstrap and recovers. (The server error DOM and the browser's
initial loading DOM differ, so Angular re-renders that subtree — a documented cost of a failed read.)

### Hydration in tiny-project

`provideClientHydration(withNoHttpTransferCache())` in the shared app config; the home and post pages
(already behind the route-level anonymous client, S01) opt in. `www`/`demo` stay SPA.

### Packed consumer

The existing consumer app gains a router, `provideClientHydration`, an `/public` page with an anonymous
component-level client, a transferred list, a default (non-transferred) control list, page-change and
reload buttons, and two test-only routes (fail-next-reads, retitle). `pnpm release:ssr` additionally runs
the built app in Chromium (Playwright resolved from `apps/tiny-project`; CI installs the browser before the
step).

## Implementation plan

- [x] 1. `credentials.ts`/`api.service.ts`/`server-token.ts`/`server-context.ts`: anonymous policy.
- [x] 2. `transfer.ts` (key, coordinator, binding) + `resources.ts` option + `ForgeResourceOptions` export.
- [x] 3. `transfer.test.ts` (jsdom) and `transfer-server.test.ts` (`platformServer`).
- [x] 4. tiny-project: hydration provider, opted-in pages, e2e (request count, console, state); e2e helper
     waits for hydration before typing (SSR markup is interactive-looking before it).
- [x] 5. `verify-ssr-consumer.mjs`: public page, HTML/state inspection, concurrent `/public` renders,
     Chromium journey; CI order.
- [x] 6. Docs (`ssr.md`), STATE/ROADMAP/0.9 page, release-truth cleanup, API baseline, changeset.
- [x] 7. Gates.

## Acceptance criteria

1. No option → no transfer, identical behavior (existing tests unchanged).
2. A non-anonymous client with `{ transfer: 'public' }` throws `TypeError` (credentialed, token, forwarded
   Authorization).
3. A successful SSR result is serialized by Angular's mechanism under the logical key; the key contains no
   origin and the state no error.
4. The first browser resource(s) with that key use it with zero requests; the control read still repeats.
5. page/sort/where/depth/locale/collection/id changes never match; `reload()` and key changes read.
6. After the window closes, entries are gone and later resources read.
7. Packed consumer: HTML has real content, one public entry, awkward text round-trips, no secrets;
   hydration reuses the DOM with zero console problems and 0 transferred reads; navigation/reload/full
   reload as above; an injected SSR failure is not serialized and the browser recovers with one read;
   9 concurrent `/public` renders (anonymous/A/B) carry the same single anonymous entry.
8. Browser bundle still has no server code or secrets; `pnpm check:api` shows only `ForgeResourceOptions`.

## Versioning

Additive, opt-in, default unchanged → **patch** changeset for `@forge-cms/angular` (fixed group → `0.10.1`).
npm `latest` was verified as `0.10.0` on 2026-10-07 (GitHub release `v0.10.0`, PR #72 merged).

## Open questions

None blocking. Recorded: a thrown `TypeError` (not a silent fallback) for ineligible clients, so a developer
asking for public transfer never silently gets none — nor, worse, personalized data.

## Outcome

Implemented as designed, with one tightening from the spec review: on a **server platform without
`provideForgeCmsServer`** the client is also ineligible (identity unknown — e.g. a custom in-process transport),
so `{ transfer: 'public' }` throws there too (test added). Notable findings: (1) hydration makes the server markup of every page visible
and form-like _before_ the app attaches — tiny-project's e2e must wait for the `ngh` annotations to
disappear before typing (a pre-existing race that SSR without hydration hid by re-rendering); (2) an
untransferred (default) resource re-renders its list from empty at hydration — the packed consumer keeps
one as a control, which also measures the pre-S02 request count (1 read) beside the transferred one (0).

Evidence is recorded in [STATE.md](../STATE.md) (newly executed vs inherited).
