# @forge-cms/demo-aesthetics — Lumea Aesthetics

A marketing site for a fictional skin & body clinic, built entirely on ForgeCMS. It exists to answer
one question the rest of the repo cannot: **what breaks when you build a real site with this?**

The answer is written up in [docs/DEMO-FINDINGS.md](../../docs/DEMO-FINDINGS.md). Every workaround in
this app is marked `FINDING n` in a comment pointing back to it. Spec:
[039](../../docs/specs/039-real-world-demo-app.md).

> **The app was built first with no changes to `packages/*`** — the point being that gaps stay
> visible as app-side workarounds instead of quietly disappearing into the CMS. Specs
> [040](../../docs/specs/040-core-fixes-from-demo-findings.md),
> [041](../../docs/specs/041-client-query-api.md) and
> [042](../../docs/specs/042-admin-field-widgets-and-list-view.md) then fixed 12 of the 22 findings,
> and this app deleted the matching workarounds. What is left in here still marked `FINDING n` is
> what the CMS still does not do.

## Run it

```bash
pnpm install && pnpm build          # packages must be built first (tsconfig maps to dist/)
pnpm dev:demo                       # http://127.0.0.1:5174
```

Sign in at `/login`:

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
| `/admin`                      | `@forge-cms/admin`'s real layout, list and schema-driven form.                                             |
| `/admin/collections/bookings` | The booking inbox, including the request you just sent from `/booking`.                                    |

## How it is wired

```
src/server/api/collections.ts   11 collections: hooks, function-based access, drafts, blocks, uploads
src/server/api/seed.ts          realistic content, written through the Local API
src/server/routes/api/site/*    purpose-built endpoints — the Local API, no HTTP hop
src/server/routes/api/v1/*      the generic CRUD handlers from @forge-cms/runtime
src/app/pages/site/*            the public site
src/app/pages/admin/*           the editor UI
src/tests/content-model.test.ts 18 tests driving the content model through the Local API
```

The interesting file is [`src/server/routes/api/site/home.get.ts`](src/server/routes/api/site/home.get.ts):
five collections composed into one payload, with access control and draft rules applied, in one
server-side call each — the thing [ROADMAP.md](../../docs/ROADMAP.md)'s thesis is about.

Every site endpoint calls the Local API with `overrideAccess: false, user: null`, so the public site
is subject to exactly the rules an anonymous HTTP caller would hit rather than trusting itself.

## Conventions worth knowing

- **Tests live in `src/tests/`, not next to the code.** Nitro bundles everything under `src/server/**`
  into the worker, so a `*.test.ts` there drags `vitest` into the server bundle and the API crashes
  on the first request.
- SSR is off (`ssr: false`), as in `apps/www` — see finding 2.
- Seeded images are static SVGs in `public/images`; uploads go through the storage adapter and are
  served back by `routes/api/media/[...key].get.ts` (finding 21).

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

No migrations are needed: the runtime's `syncSchema()` creates the tables on the first request, and
the seed runs exactly once because it checks for an existing `site_settings` row.

## Not included

No e2e suite — Playwright stays in `apps/www` per CONVENTIONS.md.
