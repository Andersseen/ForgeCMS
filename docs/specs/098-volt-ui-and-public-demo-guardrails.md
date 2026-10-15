# 098 — Volt UI consolidation and a bounded public demo

- **Status:** done (pending maintainer review)
- **Author:** agent draft (maintainer-requested final pre-RC application hardening packet)
- **Date:** 2026-10-15
- **Branch:** `feature/spec-098-volt-demo-guardrails`
- **Affected packages/apps:** `apps/www`, `apps/demo-aesthetics`, `scripts/verify-deployment.mjs`, CI (one extra e2e step), docs. **No `packages/*`, `api-baseline/*`, version or public-package changeset change** (one empty, no-release changeset for the private apps).

## Context / Why

PR #103 (spec 097) merged as main `92a4735`; it carries the prepared, certified, **unpublished** candidate `1.0.0-rc.2` (npm `latest` `0.13.4`, no `rc` tag, `@forge-cms/agent` absent, no open PRs, main CI green).
Two things remained before the public RC: (A) spec 097 hand-built a few real controls although `@voltui/components` 1.1.0 owns the primitive, and (B) the hosted Lumea demo — published admin credentials,
anyone on the internet — was protected by an **in-memory, per-isolate** throttle and **row-count ceilings** only. Ceilings bound how many rows exist, not how often rows are written: create → prune → create keeps a
collection constant while consuming D1 writes indefinitely, and enough creates would eventually prune the seeded documents.

## Goal

The website and Lumea use Volt UI for real interactive controls (marketing illustrations stay custom), and the hosted Lumea stays interactive while its persistent mutations are an explicit, fail-closed, globally
budgeted allowlist — so it cannot be used as someone else's free database or object store. No public package API or rc.2 artifact changes.

## Non-goals

No new field kind, admin capability or Volt component; no Angular Movement work; no page builder; no demo SSR migration; no general rate-limiting feature in Forge core; no new adapter; no RC publication; no
Cloudflare plan change; no remote Cloudflare mutation without authorization. **No "zero cost forever" promise** (see Honest limits).

## Part A — Volt UI

### Audit (installed `@voltui/components` 1.1.0, read from its `.d.ts`/`fesm2022`, not assumed)

| Where                                                                                                 | Control                                               | Decision                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| www localization ES/EN                                                                                | `<button aria-pressed>` group                         | **REPLACE** → `VoltToggleGroup type="single"` + `VoltToggleGroupItem` (radio semantics: exactly one checked, arrow keys)                                                                                                                            |
| www analytics 24h/7d/30d/90d                                                                          | same group                                            | **REPLACE** → same primitive                                                                                                                                                                                                                        |
| www analytics top pages / referrers / countries bars                                                  | `<i style.width.%>`                                   | **REPLACE** → `VoltMeter` (+ track/indicator): these are shares of a whole, i.e. a _meter_, not progress                                                                                                                                            |
| www roadmap rail                                                                                      | `<div><span width>`                                   | **REPLACE** → `VoltProgress` (`role=progressbar`, "N of M milestones complete")                                                                                                                                                                     |
| www roadmap prev/next                                                                                 | `<button class=forge-roadmap-nav>`                    | **REPLACE** → `button[voltButton] variant=outline size=icon` (disabled, aria-label, native `scrollBy` kept)                                                                                                                                         |
| www docs "breadcrumb"                                                                                 | a `<p>` group label (spec 097 called it a breadcrumb) | **ILLUSTRATION** — it is a section kicker, not a link trail; nothing to replace. (Volt's `VoltBreadcrumbLink` renders a plain `href`, which would full-page-reload an Angular Router SPA, so it would not be adopted for real router links either.) |
| www docs mobile disclosure                                                                            | `<details>/<summary>`                                 | **KEEP NATIVE** — equal-or-better semantics, works without JS and during SSR/prerender; `VoltAccordion` would add behavioural state for no gain                                                                                                     |
| www story panels, terminal, admin mock, bento, code drawings, package stack, dashboard preview layout | custom                                                | **ILLUSTRATION** — domain-specific marketing visuals                                                                                                                                                                                                |
| www `<a voltButton>` links, theme toggle, tabs                                                        | Volt                                                  | **VOLT** — already correct                                                                                                                                                                                                                          |
| demo admin media: alt-text `<input>`, Upload `<button>`, error `<p>`                                  | custom                                                | **REPLACE** → `VoltInput`, `VoltButton`, `VoltError`                                                                                                                                                                                                |
| demo admin media `<input type=file>`                                                                  | native                                                | **KEEP NATIVE** — Volt's file primitive is a dropzone that creates its own input on demand; a single image picker gains nothing (no fake picker built)                                                                                              |
| demo dashboard retry buttons                                                                          | underlined `<button>`                                 | **REPLACE** → `button[voltButton] variant=link`                                                                                                                                                                                                     |
| demo login, settings                                                                                  | Volt                                                  | **VOLT**                                                                                                                                                                                                                                            |
| demo public booking form (inputs/select/textarea/submit)                                              | native, clinic-branded                                | **KEEP NATIVE** — the public clinic's own visual/domain layout (pill buttons, brand type); native labelled controls are correct and the booking e2e relies on them                                                                                  |

Dead CSS removed with the replaced controls: the toggle button/selected/focus rules, the roadmap rail and nav-button rules, the `.forge-dash-list i` bar. Contextual layout (`.forge-l10n-switch`,
`.forge-dash-ranges`, `.forge-roadmap-rail`, `.forge-dash-meter`) only positions Volt; no Volt internal class is targeted (the meter track is addressed by its public element name for sizing only).

### Angular Movement audit — **no Movement debt found**

`@keyframes`, `animation:`, Web Animations API, manual interpolation, custom spring/tween: none in `apps/www`. The only `requestAnimationFrame` calls throttle scroll _measurement_ (story active stage, docs outline) —
state, not animation. The story's active-stage calculation intentionally stays plain Angular/browser state (Movement's `moveScroll` emits no progress under reduced motion). Nothing was rewritten.

## Part B — Bounded public demo

### Two explicit modes

`FORGE_PUBLIC_DEMO=1` (set in `apps/demo-aesthetics/wrangler.toml` `[vars]`) selects **public** mode. Unset (local dev, e2e, any clone) is **full**: every dogfood operation works. Never inferred from hostname,
missing secret or `NODE_ENV`. `GET /api/demo-policy` is the read-only introspection (mode, what visitors may do, remaining budget); `GET /api/status` reports `mode`.

### Public mutation policy — an allowlist (`demo-policy.ts`, pure `decide()`)

| Request                                                    | Public mode                                                                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| reads                                                      | allowed; script-grade `/api/*` reads throttled per IP (`/api/site/*`, status, policy, media exempt) |
| `POST /api/auth/login`, `logout`                           | allowed (login: own limiter)                                                                        |
| `POST /api/site/bookings`                                  | allowed — own per-IP limiter **and** global daily budget `BOOKING_CREATE`                           |
| `PUT /api/v1/notices/:id` (EN/ES, draft/publish)           | allowed — per-IP limiter **and** global daily budget `CONTENT_UPDATE`                               |
| `POST /api/analytics/collect`                              | allowed — own limiter, never the content budget                                                     |
| any other `PUT` (services, staff, pages, settings, media…) | 403 `demo_read_only`                                                                                |
| `POST /api/v1/*` (generic create)                          | 403 `demo_create_disabled`                                                                          |
| `POST /api/v1/media` (R2 upload)                           | 403 `demo_uploads_disabled` — **disabled**, not budgeted                                            |
| `DELETE /api/v1/*`                                         | 403 `demo_delete_disabled`                                                                          |
| signup, `/api/auth/users*`                                 | 403 `demo_accounts_disabled`                                                                        |
| anything else that mutates                                 | 403 `demo_read_only` (default deny)                                                                 |

Notices are the safe editing sandbox: localized EN/ES, drafts, visible on the public site, independent of navigation/services/staff/settings/media/users. A visitor can sign in → Notices → switch EN/ES → edit →
publish → see it on the site, and cannot structurally break the demo. A `beforeChange` hook keeps a notice's link an in-site path. Public bodies are capped at 16 KB **and a declared length is required**; the
generic 256 KB / 2 MB caps remain for full mode.

Responses: `403` intentionally unavailable, `429` rate/budget exhausted, `413` size, `503` budget store unavailable (fail closed) — never a generic 500, never provider ids, billing, stacks or secrets. Each carries
`data: { code, demo: true }`; the code is app-specific (no Forge core change). The booking page turns exhaustion into "The shared demo has reached today's appointment-write limit. Try again later."

### Global daily budget (D1) — why not Cloudflare's rate-limit binding

Verified against current Cloudflare docs (2026-10-15): the Workers Rate Limiting binding only supports 10 s / 60 s periods, is **per Cloudflare location**, is documented as permissive/eventually consistent
("not designed to be an accurate accounting system"), and its documentation does not state Pages Functions support. It cannot express "N per UTC day across everything", so it was not used. The budget is a tiny
app-owned D1 table instead (no new billable resource):

`demo_budget(bucket TEXT PRIMARY KEY, used INTEGER)` — one row per class per UTC day (`2026-10-15:CONTENT_UPDATE`). No IP, user or payload. Created by the **reviewed migration**
`20261015_001_demo_budget` (never at startup). One atomic statement per attempt:
`INSERT … ON CONFLICT(bucket) DO UPDATE SET used = used + 1 WHERE used < ? RETURNING used` — N allowed, N+1 refused, race-safe; a full bucket writes nothing. Once a bucket is seen exhausted the isolate refuses from
memory for the rest of the day, so **blocked traffic costs no D1**. The first write of a day deletes older buckets (≤ 2 rows live). Any D1 error or a missing table **fails closed** (503). Without a D1 binding
(local) an in-process store with identical semantics is used. The in-memory per-IP limiters remain as the fast first layer (per class: content 6/min, booking 3/min, login 10/min, analytics 40/min, API reads
180/min per IP, each with a per-isolate breaker).

Budgets (`PUBLIC_DAILY_BUDGETS`, `demo-limits.ts`): `CONTENT_UPDATE` 150/day, `BOOKING_CREATE` 30/day; uploads 0 (refused). Chosen from **measured amplification** (`demo-policy.test.ts`): a notice edit or
publish ≤ 5 adapter row writes (the doc plus its version snapshot); a booking ≤ 1 + `MAX_PRUNE_PER_WRITE` (5). Worst case ≈ 150 × 2 × 10 + 30 × 6 × 10 ≈ 4,800 row writes/day _assuming 10 per action_ — a small
fraction of the D1 free daily allowance, so an abusive user meets Forge's guard long before the provider's. No provider number is encoded in code or UI.

### Canonical seed content

`SEEDED_DOCUMENTS` records how many documents the seed creates per collection; they are the oldest by `created_at`, so pruning **skips the first N** and only deletes what was added later (≤ `MAX_PRUNE_PER_WRITE`
per write, `afterDelete` hooks only, so pruning cannot cascade). A test seeds and fails if the constants drift. In public mode generic create/delete/non-notice update are refused outright, so canonical
services/categories/staff/pages/settings/media cannot be changed or removed; floors remain.

### Reads, health, cache

`/api/status` previously counted every collection on every request. It now returns adapter names, `mode`, and `seeded` from **one** `count(site_settings)` memoised 30 s — enough to prove runtime start, D1,
auth/storage profile and seed. `verify-deployment.mjs` additionally checks `/api/demo-policy` is `public` and sends an **unauthenticated `DELETE`** that the policy must answer `403 demo_delete_disabled` before
auth or any database access: proof the allowlist is live with zero mutation. The 60 s public-read cache (`s-maxage=60`, `max-age=0`, invalidated by any local write) was reviewed and kept: publish → reload still
shows the change on the isolate that handled the write.

### UI

`<lumea-demo-notice>` (Volt Alert) on the admin overview and Media: what you can do, what is limited, and that your own ForgeCMS project has no such limits. `/admin/media` in public mode replaces the upload
form with "Uploads are disabled in the shared public demo…". `/demo` on the website says the hosted demo limits destructive and storage-heavy actions and that a real project does not.

### Honest limits

Application code cannot guarantee zero cost against arbitrary distributed traffic: requests still invoke Functions before code can refuse them, and an attacker can exhaust the day's budget (fail-closed:
editing/bookings pause until 00:00 UTC; browsing is unaffected). Per-IP limits are per isolate. **Owner follow-up (not done, not claimed):** put the demo on a custom subdomain of a Cloudflare zone and add a
zone rate-limiting rule on `/api/*` write paths so abuse is rejected before the Functions runtime; `*.pages.dev` has no such rule.

### Cloudflare plan assumptions (read from official docs 2026-10-15; not product constants)

| Service                   | Free-plan behaviour                                                                                    | Lumea operations                                      | Safeguards                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| Workers / Pages Functions | daily request quota shared with Workers; static assets free                                            | every `/api/*` call                                   | cached public reads, per-IP/per-class limiters, default-deny mutations |
| D1                        | daily rows read/written + storage limits **hard-fail** on free (queries error); paid is billed per row | content reads, notice edits, bookings, budget counter | allowlist, daily budget, ceilings + protected seed, minimal status     |
| R2                        | free monthly storage/Class A/Class B amounts; usage beyond is billable                                 | seeded images are static files; uploads               | **uploads disabled in public mode**; full mode only locally            |
| Analytics Engine          | free-plan daily write/read allowances; documented as not currently billed                              | pageview collector, summary read                      | own limiter, existing sanitisation, no identifiers                     |
| Rate Limiting binding     | not used (see above)                                                                                   | —                                                     | —                                                                      |

The deployed account's actual plan was not inspected (no authorisation to read account billing).

## Acceptance criteria

- [x] Starts from main `92a4735` (PR #103); `git diff 92a4735 -- packages api-baseline` empty; manifests `1.0.0-rc.2`.
- [x] Volt audit recorded; ES/EN, ranges, progress, nav, meters replaced; breadcrumb/details/booking/file input decisions justified; dead CSS removed; no Volt-internal selectors.
- [x] Movement audit: no debt; story calculation untouched.
- [x] Public mode explicit; full mode unrestricted; allowlist, notices sandbox, canonical-seed protection, uploads disabled, booking/analytics/login policies, global race-safe fail-closed budget, no stored IP.
- [x] `/api/status` cheap; verify-deployment checks policy + a safe destructive refusal; media/admin/demo copy explain restrictions.
- [x] Unit (allowlist, budget boundary + 20-way concurrency on real SQL, middleware, pruning, amplification), public-profile e2e, full-demo e2e, www e2e green.

## Outcome

See STATE.md and the PR description for the verification record. **Remote actions NOT performed** (need authorisation, see below): applying migration `20261015_001_demo_budget` to the remote `forge-cms-demo` D1;
until it is applied the deployed public demo **fails closed** (edits/bookings answer 503, browsing works). Exact sequence in `docs/DEPLOYMENT-HEALTH.md` ("Spec 098").
