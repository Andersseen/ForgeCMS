# @forge-cms/demo-aesthetics — Lumea Aesthetics

A marketing site for a fictional skin & body clinic, built entirely on ForgeCMS. It exists to answer
one question the rest of the repo cannot: **what breaks when you build a real site with this?**

The answer is written up in [docs/DEMO-FINDINGS.md](../../docs/DEMO-FINDINGS.md). Every workaround in
this app is marked `FINDING n` in a comment pointing back to it. Spec:
[039](../../docs/specs/039-real-world-demo-app.md).

> **The app was built first with no changes to `packages/*`** — the point being that gaps stay
> visible as app-side workarounds instead of quietly disappearing into the CMS. Later specs fixed
> most findings. [Spec 071](../../docs/specs/071-0.7-consolidation-and-dogfood-refresh.md)
> (2026-09-28) re-dogfooded the app against ForgeCMS 0.7 and deleted every workaround current Forge
> replaces. What is left in here still marked `FINDING n` is either something the CMS still does
> not do, or a deliberate retention explained where it is marked (finding 4).

## Run it

```bash
pnpm install && pnpm build          # packages must be built first (tsconfig maps to dist/)
pnpm dev:demo                       # http://127.0.0.1:5174
```

Sign in at `/login` (the clinic's own branded page; `/admin` redirects there when you are signed
out):

| Role               | Email                    | Password     |
| ------------------ | ------------------------ | ------------ |
| Admin              | `demo@lumea.clinic`      | `lumea-demo` |
| Editor (frontdesk) | `frontdesk@lumea.clinic` | `lumea-desk` |

Data lives in the in-memory adapters locally, so **it resets on every reload** — the seed
([`src/server/api/seed.ts`](src/server/api/seed.ts)) reruns automatically. With a D1 binding
(`env.DB`) it persists and the seed becomes a no-op.

## What to look at

| Path                          | Why it is interesting                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `/`                           | Rendered from a `blocks` field, not a fixed template. Reorder the blocks in `/admin` and the page changes. |
| `/services/:slug`             | Composite fields (`array` benefits/FAQs, `group` aftercare) plus relations and uploads.                    |
| `/booking`                    | The only public **write**. Allowed by the collection's own `access.create`, not by the route.              |
| `/journal`                    | `drafts: true` in action — the unpublished post is invisible here and 404s by slug.                        |
| `/admin`                      | `@forge-cms/admin`'s layout, cookie session and guard; content and staff pages are package routes.         |
| `/admin/collections/bookings` | The booking inbox, including the request you just sent from `/booking`.                                    |

## How it is wired

```
src/server/api/collections.ts   11 collections: hooks, function-based access, drafts, blocks, uploads
src/server/api/runtime.ts       ForgeCmsRuntime<ServerEnv, DemoCollections>: the typed Local API
src/server/api/mappers.ts       typed CMS documents → the public view models in src/shared
src/server/api/seed.ts          realistic content, written through the Local API
src/server/routes/api/site/*    purpose-built endpoints — the Local API, no HTTP hop
src/server/routes/api/v1/*      the generic CRUD handlers from @forge-cms/runtime
src/app/pages/site/*            the public site
src/app/app.routes.ts           /admin: package content/users routes + clinic pages, all guarded
src/app/pages/admin/*           the clinic-specific admin pages (dashboard, media, settings, API)
src/tests/content-model.test.ts the content model driven through the typed Local API
```

The interesting file is [`src/server/routes/api/site/home.get.ts`](src/server/routes/api/site/home.get.ts):
five collections composed into one payload, with access control and draft rules applied, in one
server-side call each — the thing [ROADMAP.md](../../docs/ROADMAP.md)'s thesis is about.
[`src/server/api/service-detail.ts`](src/server/api/service-detail.ts) shows the query side:
`findOne` by slug and a database-side `containsValue` filter for "staff who perform this treatment".

Every site endpoint calls the Local API with `overrideAccess: false, user: null`, so the public site
is subject to exactly the rules an anonymous HTTP caller would hit rather than trusting itself.

**Why the public site does not call `CmsApiService` directly.** It could — the Angular client
expresses every query this site makes, and the admin uses it. But each public page needs several
collections at once. Composing them on the server means one request per page, the same access rules
as an anonymous visitor, and a small view model instead of raw documents (internal fields never leave
the server). That is the architecture this demo recommends, not a workaround.

## Conventions worth knowing

- **Tests live in `src/tests/`, not next to the code.** Nitro bundles everything under `src/server/**`
  into the worker, so a `*.test.ts` there drags `vitest` into the server bundle and the API crashes
  on the first request.
- SSR is off (`ssr: false`), as in `apps/www` — see finding 2.
- Seeded images are static SVGs in `public/images`; uploads go through the storage adapter and are
  served back by `routes/api/media/[...key].get.ts`, a thin wrapper over the runtime's `handleFile`.
- `e2e/` gives each spec file its own write-throttle bucket (`e2e/visitor.ts`); otherwise a full
  local run trips the demo's own 12-writes-a-minute guard.

## Deployment

CI publishes this app to its own Cloudflare Pages project, `forge-cms-demo`, on every push to `main`
(the `deploy-demo` job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)). It reuses the
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets `apps/www` already uses, and creates the
project on the first run. `apps/www`'s landing dialog links straight to it.

[`wrangler.toml`](wrangler.toml) binds a **D1 database** (`forge-cms-demo`) and an **R2 bucket**
(`forge-cms-demo-media`), both created once with:

```sh
pnpm exec wrangler d1 create forge-cms-demo
pnpm exec wrangler r2 bucket create forge-cms-demo-media
```

The binding **names** are what matter: `getServerRuntime` picks `D1DatabaseAdapter` only when
`env.DB` exists and `R2StorageAdapter` only when `env.BUCKET` does, and falls back to the in-memory
adapters otherwise — silently. A renamed binding therefore looks like a working deploy that forgets
everything between cold starts.

### Schema changes on the deployed demo

- **Fresh database:** `syncSchema()` creates every table on the first request. The seed then runs
  once, because it checks for an existing `site_settings` row.
- **Safe additive changes** (a new optional field, a new collection, a new index) are applied on the
  next cold start, in one transaction.
- **Anything else** — a removed or renamed field, a type change, a new required field on a table with
  rows — makes `syncSchema()` throw `SchemaDriftError` (since `0.8.0`). The Worker then answers 500 on every API route rather than serving a half-matching
  schema. Run `runtime.planSchema()` against the production D1 before deploying such a change; see
  [docs/SCHEMA-UPGRADES.md](../../docs/SCHEMA-UPGRADES.md).
- Such a change is applied with a reviewed migration (`runtime.runMigrations()`, spec 072), run from
  a deploy/maintenance script against a backed-up database, never at Worker startup.

That is also why clinic settings are still a one-row `site_settings` **collection** rather than a
global (finding 4). A global is a new `_global_site_settings` table: sync would create it safely, but
empty, while the edited settings stay in the old table. Moving that row is a data migration. The
mechanism exists since spec 072 (M02), but running it against the deployed D1 is a production
operation that needs a backup first, so it has not been done; backup/restore rehearsal is M03.

The production secret matters too: since spec 069, a build without an `AUTH_SECRET` of at least 32
bytes refuses to start.

## Running in public without going bankrupt

The demo publishes its own admin password, so anyone can write to it. On a free Cloudflare plan
(100k Worker requests/day, 100k D1 rows written/day, 10 GB in R2) that needs limits, and they all
live in this app — `getServerRuntime` is a deployment, not a CMS feature:

| Guardrail                                                                       | Where                                                  | What it stops                                                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Public reads cached 60 s per isolate (`s-maxage` for CDNs; browsers revalidate) | [`public-route.ts`](src/server/api/public-route.ts)    | The marketing site hammering D1. Any write clears it, so publishing looks instant.       |
| 12 writes/minute per IP, 240 per isolate                                        | [`demo-guard.ts`](src/server/middleware/demo-guard.ts) | A loop from one machine. Per-IP, not per person — that needs accounts.                   |
| Body ≤ 256 KB, uploads ≤ 2 MB                                                   | same                                                   | Oversized payloads and R2 filling up.                                                    |
| `/api/auth/users` returns 403                                                   | same                                                   | Account spam, and someone deleting the demo admin.                                       |
| Ceilings per collection, oldest pruned                                          | [`demo-guards.ts`](src/server/api/demo-guards.ts)      | Unbounded growth. Writes still succeed — a demo that starts refusing bookings is broken. |
| Floors per collection                                                           | same                                                   | Someone emptying the treatment menu and leaving the site blank.                          |

The numbers are all in [`demo-limits.ts`](src/server/api/demo-limits.ts). None of it is security: it
is a spending limit. If the demo ever moves to a custom domain, a WAF rate-limiting rule (one is free
per zone) filters abuse before it reaches the Worker and is worth adding on top.

## Forge Analytics (experimental, spec 057)

This app is the dogfood target for [Forge Analytics](../../docs/specs/057-cloudflare-analytics-foundation.md)
— a privacy-minimizing, Cloudflare-first pageview analytics module. It is opt-in and does not affect
`apps/www` or `apps/tiny-project`.

- **Collection**: [`app.config.ts`](src/app/app.config.ts) adds `provideForgeAnalytics({ enabled:
true })`; a first-party tracker beacons `POST /api/analytics/collect` on load and on every SPA
  navigation (only the entry pageview includes `referrer` — it doesn't change across a session).
- **Storage**: the `ANALYTICS` binding in [`wrangler.toml`](wrangler.toml) writes to a Cloudflare
  Analytics Engine dataset. No binding → the collector silently no-ops (`NoopAnalyticsWriter`) instead
  of failing the public site.
- **Reading**: `/admin/analytics` (admin-only) reads `GET /api/analytics/summary`, which needs
  `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_ANALYTICS_TOKEN` — copy
  [`.dev.vars.example`](.dev.vars.example) to `.dev.vars` to test it locally, or set them as Pages
  secrets in production. Missing either one renders a "not configured" state, not an error.
- No unique visitors, cookies, or persistent identifiers — see the spec for the exact fields collected
  and deliberately not collected.

## Tests

- `pnpm test:demo` — the content model through the typed Local API: access, drafts, hooks, the
  service-detail queries (`findOne`/`containsValue`), typed-registry compile checks and the demo
  limits.
- `pnpm e2e:demo` (Playwright, dev server) covers:
  - the public journeys: home, treatment detail, journal and a post, a booking that lands in the
    staff inbox, and a not-found treatment;
  - auth: the guard redirect with `returnUrl`, the cookie session, and logout that really signs out;
  - content: create a draft treatment in the package editor, publish it from the list, see it on the
    site;
  - media: upload and serve a file;
  - the admin at phone width;
  - signup.

## Still worked around here

These are real gaps, each marked `FINDING n` in the code (details in
[DEMO-FINDINGS](../../docs/DEMO-FINDINGS.md)):

- `site_settings` as a collection (4 — retained until M02);
- no email on booking (6);
- richtext flattened to paragraphs, no renderer (7);
- `blocks` rows cast at the render site (16);
- no hook access to the CMS, hence `runtime-ref.ts` (23);
- `date` typed as `Date` but written and read as strings (24);
- money as `number`, zone-less appointment times (3);
- copied auth route files (11);
- no SSR (2).

## Not included

Browser automation for the analytics tracker/dashboard specifically — `e2e/` does not drive a real
pageview through `/api/analytics/collect` end-to-end (see spec 057's Test plan: that needs a real
Analytics Engine dataset, not something CI can provision).
