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

## ✅ Critical finding, fixed 2026-07-07 (was: client-only static deploy)

The production deploy used to be **client-only static files** (`analog({ ssr: false })` +
`dist/client`-only upload), so the online `/admin` couldn't load data. Fixed by P1-1 / spec 002: the
deploy now uses Nitro's `cloudflare-pages` preset (`apps/www/dist/analog/public`, incl. `_worker.js`),
so `/api/*` is served for real online. See [specs/002-deploy-api-cloudflare-pages.md](specs/002-deploy-api-cloudflare-pages.md)
for the full investigation and the critical seed-timing bug it also fixed.

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

### ~~P1-1 · Deploy the API to Cloudflare Pages (server build)~~ — `L` — done 2026-07-07

- **Spec:** [specs/002-deploy-api-cloudflare-pages.md](specs/002-deploy-api-cloudflare-pages.md)
  (status: done). Fixed a critical latent bug found during investigation: demo seed data was
  fire-and-forget at module scope, silently failing on Cloudflare Workers (disallows async I/O outside
  a request handler) — every collection would have been permanently empty online. Fixed via lazy,
  request-triggered seeding (`getServerRuntime()`). Also removed a pre-existing duplicate,
  ungated deploy workflow (`deploy.yml`) that raced the gated `deploy-cloudflare.yml` on every push.
  Verified locally end-to-end against a real `wrangler pages dev` (workerd) instance.
- **Remaining:** verify `curl https://<deployed>/api/status` on the actual production URL after the
  next merge-to-main deploy (can only be confirmed post-deploy, not from local dev).

### ~~P1-2 · Collection detail page (browse documents)~~ — `M` — done 2026-07-07

- **Spec:** [specs/003-collection-detail-page.md](specs/003-collection-detail-page.md) (status:
  done). Added `fieldDefinitions` to `GET /api/v1/collections` (additive). Hit a version mismatch
  mid-implementation — installed `@voltui/components@0.1.0` had no Table/DatePicker/Drawer exports —
  resolved by bumping to `^0.6.0` (+ `lumen-icons`, `quartz-headless`, `angular-movement`).
  **Not yet visually verified in a real browser** — do a manual pass in `pnpm dev:www` before demoing.

### ~~P1-3 · Schema-driven document form: create / edit / delete~~ — `L` — done 2026-07-07 · the "wow" feature

- **Spec:** [specs/004-schema-driven-document-form.md](specs/004-schema-driven-document-form.md)
  (status: done). Three divergences found and resolved during implementation: `VoltNativeSelect`
  instead of the full custom `VoltSelect`; hand-rolled Tailwind modal chrome instead of `VoltDialog`
  (its trigger+TemplateRef composition couldn't be visually verified); and a corrected client-side
  `ApiValidationError` that parses the *real* error shape the write routes return
  (`{ data: { errors } }` via h3's `createError`), not the `{ error, details }` shape ARCHITECTURE.md
  documents — that mismatch is now STATE.md known issue #5, unresolved.
- **Verification:** full CRUD cycle (create/update/delete + validation-error shape) confirmed against
  the real running dev server via curl. **Not yet visually verified in a real browser** — do a manual
  pass in `pnpm dev:www` before demoing this.

### P1-4 · E2E test for the CRUD flow — `M` (after P1-2/P1-3)

- **Goal:** one Playwright spec in `apps/www/e2e/`: open admin → collection → create → see it listed
  → edit → delete. Runs in `pnpm e2e:www` and the e2e workflow.

### P1-5 · "Live demo" CTA on the landing — `S` (after P1-1)

- **Goal:** hero section button linking to `/admin` ("Explore the admin demo"), plus a one-line
  disclaimer that demo data resets periodically.

> **Demo caveat, fixed by P2-1 (2026-07-07):** in-memory adapters on Workers used to mean data lived
> per isolate and reset on cold starts. Now fixed for real — D1 persists. P1-5's disclaimer can be
> softened/removed once the D1 change is actually deployed (still pending as of this writing).

**After Phase 0 + Phase 1 the project is showable end-to-end. Everything below makes it credible as
a real product.**

---

## Phase 2 — Make it real

### ~~P2-1 · D1 persistence in production~~ — `L` — done 2026-07-07 (locally verified; not yet deployed)

- **Spec:** [specs/005-d1-persistence-production.md](specs/005-d1-persistence-production.md) (status:
  done). D1 database created (`forge-cms`); runtime construction now lazily picks `D1DatabaseAdapter`
  vs. `InMemoryDatabaseAdapter` from `event.context.cloudflare.env.DB`; seeding is idempotent (won't
  duplicate rows across cold starts). Verified against a real local D1 binding: persists across
  restarts, no duplicate seeding, a created document survives a restart.
- **Found and fixed a real bug**: `@forge-cms/db`'s `generateCreateTableSql` emitted multi-line SQL,
  which fails against real D1 (`exec()` naively splits on `\n`) — invisible in the existing mocked
  tests. Fixed + added a regression test (previously nonexistent for this function).
- **Remaining**: this hasn't gone through an actual deploy yet — confirm `curl
  https://<production>/api/status` shows `"name": "d1"` after the next merge to `main`.

### ~~P2-1.5 · apps/www routes don't delegate to `@forge-cms/runtime`~~ — new, found 2026-07-07, **not yet fixed**

⚠️ **Significant finding**, not part of any spec above: none of `apps/www`'s 5 HTTP routes actually
call `@forge-cms/runtime`'s handlers, contradicting ARCHITECTURE.md. Concretely this means **QW-4's
list-filter fix never reaches the real app** (the list route has no `where` support at all — worse
than the original bug), the error envelope doesn't match docs, and `handleUpdate`'s partial-validation
bug is duplicated rather than shared. Full detail in STATE.md known issue #1. Proposing this as its
own follow-up spec (rewrite the 5 routes to build an `ApiContext` and call the runtime handlers for
real, reconciling the envelope with what `@forge-cms/angular` now expects) — not done as part of
Phase 1/2 since it's a cross-cutting change bigger than any single spec's scope, and each spec instead
verified/worked around the actual (divergent) behavior rather than closing the gap.

### P2-2 · Auth: login + protected writes — `L` · **spec drafted, awaiting approval**

- **Spec:** [specs/006-auth-login-protected-writes.md](specs/006-auth-login-protected-writes.md)
  (status: draft). A real `SignedTokenAuthAdapter` (HS256-style, Web Crypto only, no new
  dependency), a login page with published demo credentials, `requireAuth` enforced on the three
  write routes only (reads stay open). No blocking questions — doesn't touch cloud infra. ⚠️ Note:
  since the write routes don't delegate to runtime handlers (P2-1.5), `requireAuth` must be added as
  an explicit call in each of the 3 write routes directly (already how spec 006 is designed — not
  blocked by P2-1.5, just consistent with it).

### P2-3 · Migrate admin UI into `@forge-cms/admin` — `L` · **spec required** (after P1-3 stabilizes)

Move the schema-driven form + document list + layout into the package (its skeleton components
already exist). **Decision made**: `@voltui/components` as a peer dependency (matches what's already
built; don't rewrite everything unstyled). Kills STATE.md known issue #2 (admin package dead code).

### P2-2 · Auth: login + protected writes — `L` · **spec drafted, awaiting approval**

- **Spec:** [specs/006-auth-login-protected-writes.md](specs/006-auth-login-protected-writes.md)
  (status: draft). A real `SignedTokenAuthAdapter` (HS256-style, Web Crypto only, no new
  dependency), a login page with published demo credentials, `requireAuth` enforced on the three
  write routes only (reads stay open). No blocking questions — doesn't touch cloud infra.

### P2-3 · Migrate admin UI into `@forge-cms/admin` — `L` · **spec required** (after P1-3 stabilizes)

Move the schema-driven form + document list + layout into the package (its skeleton components
already exist), decide the UI-dependency question (`@voltui/components` as peer dep vs. unstyled),
and make `apps/www` consume the package. Kills STATE.md known issue #4.

### ~~P2-4 · KV adapter or drop the claim~~ — `S/M` — done 2026-07-07

Dropped the claim: no concrete use case exists today (no caching/settings layer in the runtime), so
building a KV adapter now would be speculative. Removed "KV" from `@forge-cms/cloudflare`'s
description, keywords, and README table.

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
| ~~QW-4 filter coercion~~ | M | — | Done in `@forge-cms/runtime`, but **has no effect on the real app** — see P2-1.5 |
| ~~P1-1 deploy API~~ | L | — | Done 2026-07-07 |
| ~~P1-2 detail page~~ | M | — | Done 2026-07-07 |
| ~~P1-3 schema-driven CRUD form~~ | L | — | Done 2026-07-07 (not yet visually verified in a browser) |
| **P1-4 e2e CRUD** | **M** | — | **Locks the demo against regressions — do this next** |
| P1-5 landing CTA | S | — | Discoverability of the demo |
| ~~P2-1 D1 in prod~~ | L | — | Done 2026-07-07 (locally verified; not yet deployed) |
| **P2-1.5 routes → runtime handlers** | **M/L** | — | **Fixes QW-4 for real + the envelope/validation gaps — new, undone** |
| P2-2 auth | L | spec approval | Credibility + security |
| P2-3 admin package | L | spec (peer-dep decision made) | Makes the flagship package real |

**Suggested handoff order for a weaker model:** Phase 0 and P1-1/P1-2/P1-3 are done — but do a manual
browser pass on the new CRUD flow first (see P1-3's caveat above) before trusting it in front of
anyone. Next: P1-4 (e2e, locks in the flow) → P1-5 (landing CTA, quick).
