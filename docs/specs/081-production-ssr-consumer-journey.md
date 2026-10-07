# 081 — Production SSR consumer journey (roadmap 0.9 / S03)

- **Status:** done (2026-10-07)
- **Author:** agent draft (implementation requested by the maintainer, 2026-10-07 — "spec 081 — roadmap
  0.9 / S03"; per [SDD.md](../SDD.md) an explicit request to implement counts as approval)
- **Date:** 2026-10-07
- **Branch:** feature/spec-081-production-ssr-consumer-journey (PR #76); close-out feature/spec-081-s03-closeout
- **Affected packages/apps:** @forge-cms/db (libSQL adapter loads its client lazily), apps/tiny-project (the
  journey's app source: libSQL profile + published post body), scripts (`pnpm release:ssr` becomes the S03
  production-consumer gate, split into helper modules), CI, apps/www (`/docs/ssr`,
  `/docs/small-project-guide`), docs

## Context / Why

S01 ([078](078-request-scoped-server-transport.md)) made server renders request-scoped; S02
([080](080-safe-public-hydration-transfer.md)) lets an explicitly public read hydrate from the server's
result. Neither proved the product path a real consumer walks: bootstrap → admin → draft → publish →
production SSR → hydrate → edit → fresh SSR → draft again, on both content database profiles, from packages
only. S03 closes roadmap 0.9 by certifying that path on **production builds** (built Node server; built
Cloudflare Pages output under workerd + local D1) and by removing the one repository-private workaround S01
and S02 carried: the `@forge-cms/db` / Nitro finding.

## Evidence gathered before design (2026-10-07)

**Release truth.** Main at `0ccfe6e` (PR #75 "Version Packages" merged). Manifests are `0.10.1`; the release
job of the PR #75 run was still publishing when this work started, and npm `latest` was still `0.10.0` (GitHub
aggregate release `v0.10.0`). No open PR, no pending changeset on main. S03 therefore belongs to the same
`0.10.x` line.

**The `@forge-cms/db` / Nitro finding, reproduced.** The packed Node consumer minus its two workaround lines
(`externals.inline: ['@forge-cms/', 'drizzle-orm']`, `alias: { '@libsql/client': … '/web' }`) builds, then every
first request fails: `Cannot find module '@libsql/darwin-arm64'` (stack: `dist/analog/server/node_modules/libsql/index.js`
→ `requireNative`). Cause chain: `@forge-cms/db`'s entry re-exports `LibSqlDatabaseAdapter`, whose module
statically imports `@libsql/client` (Node build → `libsql`, which `require`s a per-platform native package by a
computed name) and `drizzle-orm/libsql` (which itself statically imports `@libsql/client`). Nitro externalizes
and file-traces them; `@vercel/nft` cannot follow the computed `require`, so the native package is never copied
and loading fails — **even for an app that only uses `InMemoryDatabaseAdapter`**, because merely evaluating the
entry loads it. The workaround papered over it by inlining the Forge/Drizzle code and swapping in the fetch-based
web client (which cannot open `file:` URLs).

Candidate fixes, evaluated against the requirements:

| Option                                                                         | In-memory consumer clean    | Existing `import { LibSqlDatabaseAdapter } from '@forge-cms/db'` | Browser/Cloudflare bundles                                                                                     | Verdict                                             |
| ------------------------------------------------------------------------------ | --------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| New subpath `@forge-cms/db/libsql`, drop the top-level export                  | yes                         | **breaking** (docs, apps, 15+ specs, API baseline)               | yes                                                                                                            | rejected: breaking restructure, not needed          |
| Keep both (subpath + top-level re-export)                                      | **no** (re-export loads it) | yes                                                              | yes                                                                                                            | rejected: does not fix the failure                  |
| `@libsql/client` as optional peer                                              | no (still evaluated)        | yes                                                              | yes                                                                                                            | rejected: does not fix it, and burdens libSQL users |
| **Load `@libsql/client` + `drizzle-orm/libsql` lazily on the first operation** | **yes**                     | **yes, source- and type-compatible**                             | yes (tree-shaken unless used; the specifier still resolves by the app's own conditions → web build on workerd) | **chosen**                                          |

Lazy loading changes one observable detail: `init()` no longer opens the database; the first operation does, so
a bad URL surfaces at the first call (a rejected promise), not at `init()`. A failed open is not cached.

**Intentional libSQL on Nitro `node-server`.** Reproduced with the lazy fix: an app that _uses_
`LibSqlDatabaseAdapter('file:…')` still fails with the same `Cannot find module '@libsql/darwin-arm64'`,
because Nitro's tracer cannot follow libSQL's native package. This is a property of a _native_ dependency and of
Nitro's tracing, not of Forge's entry, so it is configuration for the consumer who chose libSQL. Tried:
`externals.external`, `rollupConfig.external` (still traced → fail); **`nitro: { externals: { trace: false } }`**
(dependencies stay in `node_modules` instead of being traced into the output; works, with or without a direct
`@libsql/client` dependency, run from the project directory). That Nitro-documented option is the documented
recipe; a Node deployment of a libSQL consumer ships `node_modules` (`pnpm install --prod`) beside `dist/`.
Cloudflare consumers use D1 (no native module) and need nothing.

## Goal

A consumer using only public ForgeCMS packages can create and publish content through the existing Angular
admin, serve it as real production SSR HTML, hydrate it without a duplicate initial read, modify it, and observe
the fresh published result through the documented refresh lifecycle on both the Node/libSQL and Cloudflare/D1
content profiles.

## Non-goals

S3/portable files (P01–P03, roadmap 0.10); admin accessibility/redesign (U01–U03); redesigning the public site;
a `@forge-cms/analog` package (the glue measured here — one `main.server.ts`, one vite config, thin routes — does
not repeat enough to justify one; recorded in Outcome); any cache, invalidation, polling, WebSocket or realtime
infrastructure; remote Cloudflare deployment or certification (local workerd/D1 evidence only); changes to the S01
transport or S02 transfer contracts; remote/Turso libSQL.

## Design

### Contract being certified (unchanged from S01/S02, stated once)

- `TransferState` belongs only to the HTML document that contained it; it is consumed during that page's initial
  hydration and then discarded.
- Content edited elsewhere is **not** pushed into an already-loaded page. There is no process-wide content cache,
  no persistent browser Forge cache, no automatic subscription.
- SPA navigation / query change / `resource.reload()` perform the normal Forge read.
- A full page load performs fresh SSR and receives a new transferred result.

### Public packaging change (`@forge-cms/db`)

`libsql.adapter.ts`: `@libsql/client` and `drizzle-orm/libsql` become type-only static imports plus one
`openConnection(url)` doing `Promise.all([import('@libsql/client'), import('drizzle-orm/libsql')])`; `init()` stores
configuration; every operation awaits a memoized `connect()`. Public types and exports are unchanged (the API
baseline must not move). Regression test: no non-type static import of either specifier anywhere in `src/`.

### Production consumer architecture

`pnpm release:ssr` stays the single entry point and runs two packed consumers, sharing one pack:

1. **Technical fixture** (S01/S02, assertions unchanged and in full) — Node `node-server`, `InMemoryDatabaseAdapter`,
   **no libSQL workaround**: it is the regression for the packaging finding.
2. **Journey consumer** (new) — the **same app source as `apps/tiny-project`** (pages, routes, admin routes,
   collections, runtime), copied into a temporary app that installs Forge only from tarballs with strict peers.
   One source of truth: tiny-project runs it from the workspace in dev (golden-path e2e); the gate runs it from
   packages in production. Only the generated `package.json`, `vite.config.ts` (the public
   `angularLinker` from `@forge-cms/angular/vite`; the Nitro preset; for libSQL `externals.trace: false`),
   `tsconfig`, `wrangler.toml` and two request-observation files are consumer-specific. It is built twice from
   the same installed tree:
   - **Node profile:** preset `node-server`, an **on-disk libSQL file**, started with plain `node`.
   - **Cloudflare profile:** preset `cloudflare-pages`, served by `wrangler pages dev` (workerd) with a real
     **local D1** binding persisted to a temp directory.

`apps/tiny-project/src/server/api/runtime.ts` selects the database: `env.DB` → D1; `DATABASE_URL` → libSQL;
otherwise InMemory (dev). Node reads the environment from `process.env`.

### The journey (identical on both profiles; one browser run each)

Asserted with plain HTTP (no JavaScript, no cookies) where stated, with Chromium otherwise. A request observer
(`src/server/middleware`, consumer-only) records every `/api/v1/posts` read as _server_ or _browser_ (browsers send
`Sec-Fetch-Site`, Node fetch does not), so SSR reads are counted from the server side and browser reads
cross-checked against Playwright's request log.

1. Fresh start: `/` HTML says "No published posts yet."; no admin; `/posts/x` renders "Not found".
2. `/setup` bootstraps the first admin (a second attempt → `409`); sign out; sign in through `/admin/login`.
3. Admin creates a post (title, relation author, a body block) → list shows **Draft**.
4. Anonymous no-JS `/posts/<slug>` and `/`: status 200, **no** title/body anywhere (HTML, transfer state); the
   signed-in browser also sees "Not found" on the public page after hydration (drafts stay hidden even for an
   authenticated admin browsing the public site).
5. Admin publishes it. No-JS `/posts/<slug>`: 200, `<h1>` and body present; no `Loading…`, `SERVER_ORIGIN_REQUIRED`,
   JIT/linker/NG diagnostics; no author email/`passwordHash`/role; exactly one `forge:public:` entry containing the
   published post and no populated `users` record.
6. Browser (still signed in as admin) opens it: hydration completes without Angular/JIT/linker errors or page
   errors; server saw **1** SSR read, **0** browser reads of `/api/v1/posts`; `ngh` markers gone; restricted author
   data invisible.
7. In a second tab the admin edits the published post (title + body). The already-loaded public tab still shows
   the old content after a settle period with no new read (nothing pushed, no polling); an HTML string fetched
   before the edit is, trivially, unchanged.
8. In the public tab: SPA navigation to Home and back to the post performs normal browser reads and shows the new
   content. Then a **full reload**: fresh SSR (1 server read) containing the new content, 0 duplicate browser reads.
   No-JS fetch confirms.
9. **Restart** the production server (same libSQL file / same D1 persist dir): no-JS and browser hydration of the
   published post still work.
10. Admin returns the post to draft → no-JS `/posts/<slug>` and `/` hide it; a direct reload and an SPA navigation
    in the (admin-signed-in) browser stay correct; the SSR transfer entry is an empty result, not the post.

Also asserted once per profile: the browser bundles contain no server-only code or secret, fully linked; the
server log has no `JIT compiler unavailable`/`NG0`/`ERROR`.

### Intentionally not tested here

Remote Cloudflare, S3, admin a11y, authenticated SSR. Local workerd/D1 evidence is labelled as such everywhere.

## Implementation plan

- [x] 1. Evidence: reproduce the Nitro/libSQL failure; choose the lazy-load fix; recipe for intentional libSQL.
- [x] 2. `@forge-cms/db`: lazy libSQL loading, regression test, README note, changeset (patch).
- [x] 3. tiny-project: libSQL/`process.env` profile in `runtime.ts`; published post body on the detail page;
     README reconciled.
- [x] 4. `scripts/ssr-consumer/` helper modules; technical fixture moved over **unchanged in assertions** and
     without the workaround; journey consumer + both profiles.
- [x] 5. CI: timeout and step comments; `pnpm release:ssr` description.
- [x] 6. Docs: `/docs/ssr`, `/docs/small-project-guide`, deployment docs, STATE, ROADMAP, `0.9-ssr.md`.
- [x] 7. Gates; spec/forge-rules review; close-out.

## Test plan

`pnpm --filter @forge-cms/db test` (incl. the new regression), `pnpm release:ssr` (both consumers, both profiles,
restart), `pnpm test:libsql`, `pnpm test:cloudflare`, `pnpm e2e:tiny-project` (dev golden path unchanged),
`pnpm check:api` (no change), full repository gates.

## Acceptance criteria

1. A fresh packed consumer bootstraps its first admin; the existing Forge admin creates a post; it starts as draft.
2. Anonymous SSR cannot see the draft (HTML and transfer state); admin publishes; a **built** server renders it by
   slug before JavaScript on Node and on workerd.
3. Hydration has no Angular/JIT/linker/page errors, 0 duplicate initial reads; restricted relation data absent from
   HTML, transfer state and DOM.
4. Editing never mutates an already-loaded page; navigation/reload/full-load behave as the contract states; fresh
   SSR carries the edit and hydrates with 0 duplicate reads.
5. Node + real on-disk libSQL: content survives a server restart. Cloudflare + real local D1: journey passes.
6. The packed technical fixture builds and passes **without** the private Nitro/libSQL workaround; the journey
   consumer contains only documented public configuration.
7. S01 concurrent identity isolation and S02 HTML/transfer assertions still pass unchanged; browser bundles contain
   no server code/secrets; strict-peer install; one Angular copy.
8. `@forge-cms/db` public API baseline unchanged; db adapter contract suites green.
9. Docs let an empty project reproduce the setup; STATE/ROADMAP/0.9 page mark S01–S03 and roadmap 0.9 complete;
   nothing of S3/0.10 started.
10. Full repository gates green (see STATE for newly-executed vs inherited).

## Versioning

`packages/db` changes → one **patch** changeset (fixed group; behavior-compatible, no export change). No version is
edited by hand. Completing roadmap 0.9 does not bump a minor.

## Open questions

None blocking.

## Outcome

**Merged core (PR #76):** lazy libSQL in `@forge-cms/db` (+ `lazy-libsql.test.ts`, patch changeset
`lazy-libsql-client.md`), tiny-project profiles (`env.DB` → D1, `DATABASE_URL` → libSQL, else InMemory) and post body,
`scripts/ssr-consumer/{shared,technical,journey}.mjs`, both production profiles passing.

**Close-out PR (`feature/spec-081-s03-closeout`):** extra negative controls in `journey.mjs` — admin email/id,
`passwordHash`, `_sessionVersion`, role, Bearer, cookie and `AUTH_SECRET` absent from HTML, transfer entry and
hydrated DOM; restricted `author -> users` relation is redacted to `null` for anonymous readers; no
`SERVER_ORIGIN_REQUIRED`/JIT/NG0/hydration/native-module diagnostics. (Finding: playwright's `APIRequestContext`
got `401` for `/api/v1/users` on workerd where the page's own `fetch` succeeds, so the id is read in-page.) CI
timeout 20 → 25 min (measured 13.5–14 min with the journey, 11–12 before). Docs: `/docs/ssr`, small-project guide,
deployment, tiny-project README, STATE, ROADMAP, `0.9-ssr.md`.

**Evidence (journey, both profiles):** bootstrap (second attempt 409) → sign in → admin creates a draft → anonymous
no-JS `/` and `/posts/:slug` and the admin-signed-in browser never show it → publish → no-JS HTML has `<h1>` + body →
hydration: 1 SSR read, 0 browser reads, server DOM reused → edit: loaded page unchanged, no push/poll → SPA navigation:
2 normal reads, new content → full reload: fresh SSR (1 read), 0 duplicate browser reads → server restart (same libSQL
file / same D1 directory): content persisted, same counts → unpublish: hidden in HTML, transfer state, reload and SPA.
Node = built `node-server` + real on-disk libSQL; Cloudflare = Pages output under **local** workerd + local D1.
**Remote Cloudflare deployment is not certified by S03.** Durable uploaded files are out of scope (roadmap 0.10).

**Packaging:** the technical consumer builds and passes with no alias/inline workaround. Intentional libSQL on
`node-server` documented as `nitro: { externals: { trace: false } }` + `node_modules` beside `dist/` (Nitro
`externals.trace`, nitropack 2.13.4). No `@forge-cms/analog` package needed (glue measured: one `main.server.ts`, one
vite config, thin routes).

**Public API:** unchanged (`pnpm check:api`). One existing patch changeset suffices (behavior-compatible).

**Release truth:** npm `latest` `0.10.2` (PR #77 merged; GitHub releases and npm verified).

**Gates:** see docs/STATE.md and the PR for newly-executed vs inherited results.
