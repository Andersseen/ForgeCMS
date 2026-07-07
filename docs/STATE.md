# STATE — Current implementation status

> **Last updated: 2026-07-07** (from a full code audit).
>
> **How to maintain this file:** whenever you complete meaningful work, update the relevant rows,
> the "Known issues" and "Suggested next steps" lists, and the date above. Keep it a *snapshot of
> reality*, not a wishlist — if code and this file disagree, fix this file. This is the primary
> "where were we?" document for every new session.

## TL;DR

The monorepo foundation is done and CI is green. The schema DSL, validation, runtime orchestrator,
CRUD HTTP handlers, and several real adapters (LibSQL, Cloudflare D1/R2) **exist and are tested** —
the README's claim that none of this is implemented is outdated. The www app serves a working demo
API + admin UI backed by in-memory adapters. The big gaps: the `@forge-cms/admin` package is a
skeleton not used by the demo, auth has no real provider, nothing is published to npm, and the demo
has never been wired to real Cloudflare bindings end-to-end.

## Package status

| Package | Status | What exists | What's missing |
| --- | --- | --- | --- |
| `@forge-cms/core` | ✅ Solid | Field DSL (10 kinds: text, number, boolean, date, relation, json, select, slug, email, textarea), `defineCollection`, type inference (`CollectionData`), runtime validation (`validateField`, `validateCollection`) with tests | More field kinds (richtext, upload), hooks/access-control concepts |
| `@forge-cms/db` | ✅ Solid | `DatabaseAdapter` contract, `InMemoryDatabaseAdapter`, `LibSqlDatabaseAdapter` (drizzle + @libsql/client), SQL schema generator (`generateCreateTableSql`, value converters, drizzle table cache) | Query operators beyond equality in `where`; migrations story (only `CREATE TABLE IF NOT EXISTS` sync) |
| `@forge-cms/auth` | 🟡 Partial | `AuthAdapter` contract, `ForgeAuthError`, `InMemoryAuthAdapter`, `ExternalAuthAdapter` (delegates token validation) | Real providers (JWT/OAuth/sessions), users-collection integration, roles/permissions enforcement |
| `@forge-cms/storage` | 🟡 Partial | `StorageAdapter` contract, `InMemoryStorageAdapter` | Real upload flow (multipart), file metadata collection integration |
| `@forge-cms/api` | 🟡 Minimal | `ApiContext`, `CrudHandlers` types, `defineCrudHandlers` | Anything beyond type definitions; route-mounting helpers |
| `@forge-cms/runtime` | ✅ Solid | `ForgeCmsRuntime` (binds collections + adapters, `init`, `syncSchema`), HTTP handlers `handleList/Read/Create/Update/Delete` with validation, optional auth, JSON envelopes | Hooks (beforeChange etc.), field-level access control, relation population |
| `@forge-cms/cloudflare` | 🟡 Partial | `D1DatabaseAdapter` (with index creation), `R2StorageAdapter`, hand-written binding types, tests with mocked bindings | KV adapter (mentioned in package description, absent), tests against real/miniflare bindings |
| `@forge-cms/angular` | ✅ Solid | `CmsApiService` (fetch-based, full CRUD + collections + me), `provideForgeCms`, `FORGE_CMS_CONFIG` token | Signals-based resources, SSR-safe fetch, error typing |
| `@forge-cms/admin` | 🔴 Skeleton | `ForgeAdminLayoutComponent`, `ForgeCollectionListComponent`, `ForgeCollectionFormComponent`, `ForgeAdminConfig` | Not consumed anywhere; apps/www admin uses its own local components instead |
| `@forge-cms/testing` | ✅ Solid | Contract test suites for database/auth/storage adapters (`runDatabaseAdapterContractTests`, …), exported via `@forge-cms/testing/contracts` | — |

## Apps status

| App | Status | Notes |
| --- | --- | --- |
| `apps/www` | ✅ Working demo (local only) | Analog.js + Angular 21 + Tailwind 4 + `@voltui/components`. Landing page, `/admin` demo (dashboard, collections, media, users, api, settings — read-only except settings; no per-collection detail/CRUD pages yet), h3 server API. Server runtime at `src/server/api/runtime.ts`: 9 demo collections, in-memory adapters, seed data on module load (resets every reload — intentional). Playwright e2e. ⚠️ Deploys to Cloudflare Pages **client-only** (`ssr: false`, uploads `dist/client`) — the deployed site has no `/api/*`, so the online admin can't load data. See PLAN.md P1-1. |
| `apps/playground` | ✅ Minimal | Analog.js sandbox with a sample `posts` collection + test. |

## API surface (implemented in apps/www server routes)

- `GET/POST /api/v1/[collection]` — list (supports `limit`, `offset`, equality filters via query params) / create (validated)
- `GET/PUT/DELETE /api/v1/[collection]/[id]`
- `GET /api/v1/collections` — collection metadata
- `GET /api/auth/me` — current user (optional-auth middleware puts `forgeUser` on the h3 event context)
- `GET /api/status` — adapter/API health info

Routes are thin wrappers delegating to `@forge-cms/runtime` handlers. Envelope: list `{ data, meta }`,
item `{ data }`, error `{ error, details? }`, delete `204`.

## Infrastructure

- CI (GitHub Actions): lint + typecheck + test + build on push/PR to main; separate e2e workflow; deploy-to-Cloudflare-Pages workflow (needs `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` secrets).
- Changesets configured; **no package published yet** (all 0.0.0).
- `wrangler.toml`: Pages config, output `apps/www/dist/client`, `nodejs_compat`.

## Known issues / debt (verified 2026-07-07)

0. **Production deploy is static-only** — no server/API on the deployed Cloudflare Pages site
   (`analog({ ssr: false })` + workflow uploads only `apps/www/dist/client`). The online `/admin`
   cannot fetch data. Fix tracked as PLAN.md **P1-1** (highest priority).
1. `handleUpdate` partial validation is approximate (validates merged body, then filters errors to sent fields).
2. `@forge-cms/admin` is dead code until apps/www's admin migrates to it.
3. No KV adapter despite the cloudflare package description advertising one.

## What's next

The prioritized, task-by-task execution plan lives in **[PLAN.md](PLAN.md)** (phases: quick wins →
showable demo → make it real → alpha release). Headline priorities: deploy the API to production
(P1-1), per-collection CRUD UI with schema-driven forms (P1-2/P1-3), then D1 persistence and auth.
