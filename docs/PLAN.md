# PLAN — Priorities and execution plan toward a showable demo

> **Created: 2026-07-07.** Companion to [STATE.md](STATE.md) (what exists) — this file says what to
> do next and in which order.
>
> **How to use:** each task below is a self-contained handoff unit for an AI model. Hand it over by
> ID (e.g. "do QW-2 from docs/PLAN.md"). The implementer must follow [/CLAUDE.md](../CLAUDE.md) and
> [CONVENTIONS.md](CONVENTIONS.md); tasks marked **spec** go through [SDD.md](SDD.md) first (draft →
> human approval → implement). Mark tasks done here ~~like this~~ with a date, and update STATE.md.

## The target: what "showable" means

A public URL where a visitor can open `/admin`, browse collections served by the **real ForgeCMS
runtime**, open one, and **create / edit / delete a document with schema validation** — plus a
README that presents the project honestly. That is a representative demo of the vision
("Payload for Angular").

## ⚠️ Critical finding (2026-07-07)

The production deploy is **client-only static files**: `apps/www/vite.config.ts` uses
`analog({ ssr: false })` and the deploy workflow uploads only `apps/www/dist/client`. So the
deployed site has **no `/api/*` routes** — the online `/admin` cannot load data. Everything works
only in local dev (`pnpm dev:www`, where Nitro serves the API). Fixing this (P1-1) is the single
most important step toward a showable demo.

---

## Phase 0 — Quick wins (small, independent, no spec needed, parallelizable)

### ~~QW-1 · Rewrite README.md to match reality~~ — `S` · impact: high (first impression) — done 2026-07-07

- **Goal:** README presents the project truthfully: what works today (schema DSL, validation,
  runtime, CRUD handlers, in-memory/LibSQL/D1/R2 adapters, Angular SDK, demo admin), monorepo map
  including `runtime`/`cloudflare`/`angular`, honest experimental disclaimer.
- **Source of truth:** [STATE.md](STATE.md) + [CONTEXT.md](CONTEXT.md). Keep badges, commands,
  contributing/license sections.
- **DoD:** README lists all 10 packages and both apps correctly; no claim contradicts STATE.md;
  `pnpm format:check` passes.

### ~~QW-2 · Fix `configured` expression in status route~~ — `S` — done 2026-07-07

- **File:** `apps/www/src/server/routes/api/status.get.ts`.
- **Goal:** replace the nonsense `configured: db.name !== 'in-memory' || false` with the intended
  semantics: `configured: runtime.adapters.auth.name !== 'in-memory'` (auth is "configured" when a
  real adapter is used). Also make `storage.files` honest (keep `0` with a clearer comment, or drop
  the field).
- **DoD:** `GET /api/status` (local dev) returns coherent JSON; STATE.md known issue #6 removed.

### ~~QW-3 · Translate Spanish comments to English~~ — `S` — done 2026-07-07

- **File:** `apps/www/src/server/middleware/auth.ts` (and grep for other Spanish comments).
- **DoD:** repo-wide comments are English; STATE.md known issue #7 removed.

### ~~QW-4 · Implement spec 001 (list-filter type coercion)~~ — `M` — done 2026-07-07

- **Spec:** [specs/001-list-filter-type-coercion.md](specs/001-list-filter-type-coercion.md) (status: done).
- Implemented `coerceWhere` in `packages/runtime/src/handlers.ts`, used by `handleList`; 6 new
  tests; changeset added; STATE.md known issue #2 removed.

---

## Phase 1 — Critical path to the showable demo 🔥

Do in this order; P1-2/P1-3 can proceed in parallel with P1-1.

### P1-1 · Deploy the API to Cloudflare Pages (server build) — `L` · **spec required** · ⚠️ riskiest task

- **Goal:** the deployed site serves `/api/*` (Nitro server on Pages Functions), so the online
  `/admin` works.
- **Known facts for the spec author:** dev works via Analog's Nitro server; build currently emits
  only static client (`ssr: false` + deploy of `dist/client`). Analog supports API routes without
  full SSR; Nitro has a `cloudflare-pages` preset that emits `_worker.js`. `wrangler.toml` has
  `pages_build_output_dir = "apps/www/dist/client"` and the deploy workflow uploads that directory —
  both must change to the full Pages output.
- **Investigate first** (put findings in the spec): exact Analog config for
  `nitro: { preset: 'cloudflare-pages' }`, resulting output directory, whether `ssr: false` can stay.
- **Acceptance:** `curl https://<deployed>/api/status` returns the JSON envelope; `/admin` loads
  collections online; CI deploy workflow green.
- **Note:** this task touches infra + CI; if the implementing model gets stuck after one honest
  attempt, escalate to a human or a stronger model rather than thrashing.

### P1-2 · Collection detail page (browse documents) — `M` · **spec required**

- **Goal:** route `/admin/collections/:slug` listing that collection's documents in a table
  (columns from the field definitions), with loading/error/empty states, using `CmsApiService`.
- **Context:** admin pages already read from the real API (list of collections exists); there is no
  per-collection page and zero `routerLink`s into one. Reuse the local admin components
  (`PageHeaderComponent`, `LoadingStateComponent`, …) and `@voltui/components`.
- **Acceptance:** from `/admin/collections`, clicking a collection navigates to its document list
  showing seeded data (local dev).

### P1-3 · Schema-driven document form: create / edit / delete — `L` · **spec required** · the "wow" feature

- **Goal:** from the detail page (P1-2): "New" and "Edit" open a form **generated from the
  collection's `FieldDefinition`s** (text→input, textarea→textarea, boolean→toggle, select→select,
  number→number, date→date picker, json→textarea raw, relation→plain id input for now); submit via
  `createDocument`/`updateDocument`; server validation errors (`{ error, details }`) rendered per
  field; delete with confirm.
- **Placement decision (already made):** build it in `apps/www` now for speed; migrating into
  `@forge-cms/admin` is P2-3. Don't block the demo on package design.
- **Acceptance:** full CRUD cycle on `posts` from the browser in local dev, including a visible
  per-field validation error when submitting an empty required field.

### P1-4 · E2E test for the CRUD flow — `M` (after P1-2/P1-3)

- **Goal:** one Playwright spec in `apps/www/e2e/`: open admin → collection → create → see it listed
  → edit → delete. Runs in `pnpm e2e:www` and the e2e workflow.

### P1-5 · "Live demo" CTA on the landing — `S` (after P1-1)

- **Goal:** hero section button linking to `/admin` ("Explore the admin demo"), plus a one-line
  disclaimer that demo data resets periodically.

> **Demo caveat to accept (fixed in P2-1):** with in-memory adapters on Workers, data lives per
> isolate and resets on cold starts. Fine for a demo — seed data reappears; created records may
> vanish. The disclaimer in P1-5 covers this honestly.

**After Phase 0 + Phase 1 the project is showable end-to-end. Everything below makes it credible as
a real product.**

---

## Phase 2 — Make it real

### P2-1 · D1 persistence in production — `L` · **spec required** (depends on P1-1)

Real persistence for the deployed demo: create the D1 database, bind it in `wrangler.toml`, select
`D1DatabaseAdapter` when `env.DB` exists (fallback to in-memory in dev), run `syncSchema` + seed
once. This is the moment ForgeCMS demonstrably runs on the edge for real.

### P2-2 · Auth: login + protected writes — `L` · **spec required**

A real `AuthAdapter` (start with signed-token/JWT sessions), login page, `requireAuth: true` on
write handlers, demo credentials on the login screen. Until then the demo API is intentionally open.

### P2-3 · Migrate admin UI into `@forge-cms/admin` — `L` · **spec required** (after P1-3 stabilizes)

Move the schema-driven form + document list + layout into the package (its skeleton components
already exist), decide the UI-dependency question (`@voltui/components` as peer dep vs. unstyled),
and make `apps/www` consume the package. Kills STATE.md known issue #4.

### P2-4 · KV adapter or drop the claim — `S/M`

Either implement the KV adapter mentioned in `@forge-cms/cloudflare`'s description (needs a use
case — e.g. settings/cache), or remove "KV" from the description. Honest > aspirational.

---

## Phase 3 — First release

- **P3-1** · Quickstart guide: "add ForgeCMS to an Analog app in 10 minutes" (README or docs/).
- **P3-2** · First alpha publish to npm via changesets (`0.1.0-alpha`), after P2-3.

---

## Priority summary

| Task | Size | Blocked by | Why it matters |
| --- | --- | --- | --- |
| ~~QW-1 README~~ | S | — | Done 2026-07-07 |
| ~~QW-2 status fix~~ | S | — | Done 2026-07-07 |
| ~~QW-3 English comments~~ | S | — | Done 2026-07-07 |
| ~~QW-4 filter coercion~~ | M | — | Done 2026-07-07 |
| **P1-1 deploy API** | **L** | spec | **Online demo is broken without it** |
| P1-2 detail page | M | spec | First half of the demo |
| **P1-3 schema-driven CRUD form** | **L** | P1-2, spec | **The feature that shows what ForgeCMS is** |
| P1-4 e2e CRUD | M | P1-2/3 | Locks the demo against regressions |
| P1-5 landing CTA | S | P1-1 | Discoverability of the demo |
| P2-1 D1 in prod | L | P1-1, spec | Real persistence = real CMS |
| P2-2 auth | L | spec | Credibility + security |
| P2-3 admin package | L | P1-3, spec | Makes the flagship package real |

**Suggested handoff order for a weaker model:** Phase 0 (QW-1 through QW-4) is done. Next:
(spec for P1-2) → P1-2 → (spec for P1-3) → P1-3 → P1-4. Keep P1-1 for a stronger model or human
pairing — it's investigation-heavy infra.
