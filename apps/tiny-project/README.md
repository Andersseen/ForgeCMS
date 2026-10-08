# apps/tiny-project

A deliberately tiny, external-style ForgeCMS consumer — spec
[055](../../docs/specs/055-small-project-readiness-audit.md)'s readiness fixture.

**Not a showcase app.** Its only job is proving that a small real project — users, cookie auth,
protected admin, roles, drafts, one relation — works end to end from the published `@forge-cms/*`
surface, with no host CRUD pages and no repository-internal imports. See
[docs/small-project-guide.md](../www/src/content/docs/small-project-guide.md) for the walkthrough
this app's own code is the proof of.

Content model: `users` (`defineUsersCollection()`) + `posts` (`title`/`slug`/`body`/`author ->
users`, `drafts: true`, role-gated writes) + one small upload-enabled `media` collection (spec 083: `filename`,
`url`, `contentType`, `filesize`, `alt`, `visibility`; staff read everything, everyone else only `public` rows;
staff write). Nothing else — no second content collection, no media UI of its own.

Unlike every other app in this repo, **this one seeds nothing**. First run means zero rows, zero
users — `POST /api/bootstrap-admin` (an app-local route, not a new Forge capability; see its own
doc comment) is how the very first admin gets created, at `/setup`.

## Commands

```bash
pnpm dev:tiny-project          # dev server at http://127.0.0.1:5175
pnpm test:tiny-project         # unit tests (InMemory adapters)
pnpm --filter @forge-cms/tiny-project test:libsql   # portable profile: real libSQL, no Cloudflare
pnpm test:cloudflare           # includes this app's real local D1 lifecycle proof
pnpm test:s3                   # real Garage (Docker): S3 adapter, libSQL + S3 upload lifecycle, packed consumer
pnpm e2e:tiny-project          # full browser golden path (Playwright)
```

## Profiles proven here

Database selection (`src/server/api/runtime.ts`): `env.DB` → D1; else `DATABASE_URL` → libSQL; else
`InMemoryDatabaseAdapter` (ordinary development). Storage selection (`src/server/api/storage.ts`): when any
`S3_*` setting is present → `S3StorageAdapter` (`@forge-cms/s3`), else `InMemoryStorageAdapter`. A
half-configured profile throws at startup instead of silently falling back.

| Variable                                   | Meaning                                                     |
| ------------------------------------------ | ----------------------------------------------------------- |
| `S3_BUCKET`, `S3_REGION`                   | required together once any `S3_*` is set                    |
| `S3_ENDPOINT`                              | S3-compatible service URL; omit for AWS S3                  |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | a pair; omit both to use the AWS SDK provider chain         |
| `S3_SESSION_TOKEN`                         | optional, with the pair                                     |
| `S3_FORCE_PATH_STYLE`                      | `true` / `false` (default `false`)                          |
| `S3_PUBLIC_URL_BASE`                       | default `/api/media`, the access-checked `handleFile` route |

These are server-side only (read in `nodeEnv()` / Cloudflare bindings) and never reach browser code. Files are
served by `GET /api/media/[...key]`, a thin `handleFile` route. The S3 profile is _optional_: the
"never silently use in-memory in production" policy is roadmap 0.10 / P03.

- **Cloudflare**: `D1DatabaseAdapter` when `env.DB` exists (`wrangler.toml`), proven for real (not
  mocked) by `test/workers/d1-lifecycle.test.ts` via `@cloudflare/vitest-plugin`.
- **Portable**: `LibSqlDatabaseAdapter` with no Cloudflare binding of any kind, proven for real by
  `src/tests/portable-libsql.integration.test.ts`.
- **Portable files** (spec 083): on-disk libSQL + `S3StorageAdapter` against a real Garage service, through the
  normal multipart handler and `handleFile`, with restart persistence, delete and storage-intent recovery:
  `src/tests/portable-storage.integration.test.ts` (run by `pnpm test:s3`).

Production (spec 081, roadmap 0.9 S03): `pnpm release:ssr` copies this app's source into a strict packed
consumer and walks bootstrap → draft → publish → no-JS SSR → hydration → edit → fresh SSR → restart →
unpublish on **Node `node-server` + on-disk libSQL** and on the **Cloudflare Pages output under local workerd +
local D1** (local evidence, not a remote deployment).

Both run the identical domain: schema sync, first-admin bootstrap, login, a second user, the full
post lifecycle (create/draft-hidden/publish/edit/delete), the author relation, and a role boundary
(editor may write, only admin may delete).

## What it proves today

- **Workspace packages consumed like published ones:** only `@forge-cms/*` entry points and public
  subpaths, no deep imports. `pnpm release:verify` repeats the check against the packed tarballs.
- **D1 and libSQL:** the same domain on both profiles (above).
- **Auth:** first-admin bootstrap, cookie sessions, signup opt-in, CSRF, last-admin and H04 bounds
  (`e2e/golden-path.spec.ts`).
- **Admin:** `@forge-cms/admin`'s auth, content and users routes, with no host CRUD pages.
- **Relations:** `post.author -> users`, populated with `depth=1` according to the caller's access.
- **Strata read controllers:** `GET /api/v1/:collection` and `GET /api/v1/:collection/:id`.
- **Server rendering (spec 078):** `ssr: true`. `src/main.server.ts` renders each request with
  Angular's `renderApplication`, the request's headers as `REQUEST`, and
  `provideForgeCmsServer({ origin })` (`FORGE_SSR_ORIGIN`, or `http://127.0.0.1:5175` under `pnpm dev`; a
  production render without it fails). The public pages read through `collectionResource` with their own
  anonymous client (route-level `provideForgeCms({ credentials: 'omit' })`), so the server HTML and the
  browser both show published content only. The detail and list pages use `{ transfer: 'public' }` (spec 080), so
  hydration reuses the server's result with no duplicate initial request.
  `src/tests/ssr-isolation.integration.test.ts` proves concurrent anonymous / A / B renders stay
  isolated; the e2e checks the no-JS HTML. `/api/site/*` remain the Local API server-route example.

## Strata (experimental integration)

ForgeCMS does not depend on Strata; this app does, from npm (`@strata-sc/core` and
`@strata-sc/analog` 0.1.0), as an external consumer. Strata owns transport; Forge owns CMS behaviour.

```
GET /api/v1/:collection      → CollectionsController.list → handleList
GET /api/v1/:collection/:id  → CollectionsController.read → handleRead
POST/PUT/DELETE, auth, bootstrap → H3 file routes (unchanged)
```

`src/server/strata/collections.controller.ts` only adapts the request. `createForgeReadContext`
(`forge-read-context.ts`) is **read-only and bodyless** on purpose: Strata 0.1.0's
`StrataAnalogRequest` exposes no Web `Request`, so there is no body, no `AbortSignal` and no real
origin for CSRF. It throws for any method other than GET/HEAD. Mutations move only once Strata exposes
the canonical request.

Evidence:

- `read-parity.test.ts` mounts the former H3 read handlers and the Strata plugin on two h3 apps. It
  sends identical requests (anonymous, Bearer, cookie, bad token, drafts, depth, missing id, unknown
  collection, auth-only collection, bad query) and asserts identical status, headers and body.
- `strata-registration.test.ts` checks that only the two GET routes are registered and that no
  file-system GET route competes with them.
- The e2e "read API contract" test runs against the real dev server.
- Strata code ships only in the Nitro worker chunk, never in `dist/client` or `dist/ssr`.

Strata Server Components are **not** used here: that package is unpublished and targets a newer
Angular/Analog/Vite than this repository.
