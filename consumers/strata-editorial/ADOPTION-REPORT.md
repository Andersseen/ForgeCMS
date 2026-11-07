# Strata real-consumer adoption report: ForgeCMS editorial desk

**Date:** 2026-11-07 · **Spec:** [102](../../docs/specs/102-strata-rc-real-consumer-adoption.md) ·
**Branch:** `feat/strata-rc-real-consumer-adoption` (from ForgeCMS `main` `a57c494`)

## Verdict at a glance

| Question                              | Answer                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Is Strata `1.0.0-rc.0` published?     | **No.** npm `latest`: core 0.2.2, analog 0.12.1, server-components 0.17.0. No `rc` tag. No Version Packages PR. |
| What did this consumer qualify?       | The **published RC0 baseline** tuple, on the exact RC framework tuple. **Rehearsal evidence, not RC evidence.** |
| Compatibility verdict                 | **COMPATIBLE (rehearsal)** on an isolated consumer; **INCOMPATIBLE in place** with the Angular 21 workspace.    |
| Real Strata defects found             | None blocking. Two contract/documentation findings (S-1, S-2) for separate Strata work.                         |
| Node / local workerd / Chromium       | PASS / PASS / PASS (production builds, retries off).                                                            |
| Deployed (real endpoint)              | **NOT RUN** (no deployment authorized; no Cloudflare project created).                                          |
| Operational adoption (real use)       | **NOT RUN.** See [OPERATIONAL-OBSERVATION.md](OPERATIONAL-OBSERVATION.md).                                      |
| Strata GA "real application" criteria | **Not closed.** This is integration and staging-shaped qualification only.                                      |

## 1. Upstream state verified (2026-11-07, re-checked ~12:15 UTC)

- At the start of this work Strata `main` was `b40a497`: PR #182 ("enter the 1.0 release candidate line",
  Changesets pre mode `rc`, fixed group core/analog/server-components) merged on top of PR #181 (`769928f`, RC0
  baseline recaptured on server-components 0.17.0).
- **During this work PR #182 was reverted** by PR #183 (merged 11:59 UTC). Strata `main` is now `efff41c` and is
  **not** in pre mode (`.changeset/pre.json` absent). PR #184 "chore(release): version packages (rc)", opened by the
  Release workflow at 11:44 UTC from the pre-revert state, is still open and now stale relative to `main`. The
  reason for the revert is not stated in PR #183 and is not assumed here.
- npm (registry): `@strata-sc/core` 0.2.2, `@strata-sc/analog` 0.12.1, `@strata-sc/server-components` 0.17.0
  (`latest` = `next`), each with SLSA v1 provenance. No `1.0.0-rc.*` version, no `rc` dist-tag.
  `@strata-sc/h3` unpublished (private, `NO-H3-V2`).
- Strata `docs/COMPATIBILITY.md` "RC0 support contract": still **"Proposed … No RC exists yet."** Strata's readiness
  gate (`release:rc:check`) was not run here: it is Strata's gate, run by its maintainers.

**Consequence.** Nothing in this report qualifies `1.0.0-rc.0`. The consumer is built so the RC can be adopted by
changing three exact pins; `scripts/verify-strata-tuple.mjs` refuses to label anything else as RC.

## 2. Exact tuple installed

| Package                        | Version | npm integrity (lockfile = registry)                                                               |
| ------------------------------ | ------- | ------------------------------------------------------------------------------------------------- |
| `@strata-sc/core`              | 0.2.2   | `sha512-Xr6bMt7funa/RtMhr/BTLX548alI8w5/tq/4QIgvk4INEc4nED5CweQUeEujPU6o9/NcJ1XFtqcXPNGjohkHFA==` |
| `@strata-sc/analog`            | 0.12.1  | `sha512-0ytlP1rpn5zNhUUtFo2gB6oQzvim8h9jxNBFwMYyavnnUqgHbZYauXeDQXX6Q16Aa/a+wLkMAcqwGIfqLmV4aw==` |
| `@strata-sc/server-components` | 0.17.0  | `sha512-SOrJTSac6qRhpI8cn3QL4Cr4jslHN0gwTHA9H9iSCepOHhVenzK/tpo0y0GbGh6JqoLd1/qBBx1QUj4uwMr/Og==` |
| `@forge-cms/core`              | 1.0.0   | `sha512-hTJPQGCs2emBUTz4Dh1opbi0QtISL1Y82+1J6PeLoZOeCRC2sJVltRjyjLjbWQBUiZ2X0FtYJxWUhpgvROSL/w==` |
| `@forge-cms/runtime`           | 1.0.0   | `sha512-twKbaynXBGCH4Pf+aNxv2smBOc5fiI2o1pRHAQ46Y04iNxLQDvTYA/zY0lBpqFIy3Yhu6Re3DyZmwbbXatRabA==` |
| `@forge-cms/auth`              | 1.0.0   | `sha512-1UnCaiNwZE6DSFFbGfb1tA09Zr7Hp/aEsmLas5qMA4TNzBaF3dezkR5rObJcSxnhj3Z38KDRXdgtJ9hn4lmfyQ==` |
| `@forge-cms/db`                | 1.0.0   | `sha512-hD8SJqYtzL2dhJHmsJqk6Ula/Us5oScaSMNcTs974CZse4HSdXv3dTOA3sYf6CPh7aFkxlW5s/cWjoxgKicZPA==` |

Framework (asserted by `pnpm verify:tuple`): Angular 22.2.3 (one installed copy), `@analogjs/*` 2.7.2, Vite 8.3.0,
Nitro 2.13.4, H3 1.15.11, TypeScript 6.0.3, Wrangler 4.135.0, Node 22, compatibility date 2026-09-21, no flags.
The Strata integrities equal the RC0 frozen candidate in Strata's COMPATIBILITY.md (`983f7131e39574e0`).

## 3. Integration boundary and why

| Option                                               | Decision   | Reason                                                                                                                                                                                                                                               |
| ---------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. In place (`apps/demo-aesthetics`, `tiny-project`) | Rejected   | Workspace catalog pins Vite 7.1.4; `@forge-cms/admin` peers Angular `^21`; tiny-project depends on admin; demo-aesthetics is a deployed public demo. Angular 22 there means duplicated Angular (`NO-DUPLICATES`) or a monorepo upgrade (a non-goal). |
| **B. Isolated consumer of published packages**       | **Chosen** | ForgeCMS's server packages have no Angular peer; the app can run the exact Strata tuple with one Angular copy and its own lockfile, without touching any ForgeCMS stable surface.                                                                    |
| C. Incompatibility only                              | Not needed | B is viable.                                                                                                                                                                                                                                         |

It is a **new** application, so it does not by itself prove "an existing app adopted Strata". It is not a synthetic
fixture either: it runs ForgeCMS's real Local API, access rules, session adapter and durable adapters, and an
editorial workflow with real authorization consequences.

## 4. The business vertical slice

An editorial desk: editors write posts (drafts) with an author relation; editors publish/unpublish **their own**
posts; anyone reads published posts; admins see everything.

| Route / surface                                 | Owner     | What it proves                                                                                   |
| ----------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `GET /api/editorial/posts`                      | Strata    | Controller → service → Local API; `{ data, meta }`; published only; `public, no-cache`           |
| `GET /api/editorial/posts/:id`                  | Strata    | Session identity; hidden draft = 404; `private, no-store`                                        |
| `POST /api/editorial/posts/:id/status`          | Strata    | CSRF guard → session → validation → ForgeCMS update access                                       |
| `/posts/:slug`                                  | Strata SC | Strict Server Component, buffered SSR, `/ssr` contract, two islands, guarded document navigation |
| `/`, `/login`, `**` 404                         | Angular   | Conventional browser-owned routes coexisting with Server Component routes                        |
| `/api/account/{login,logout,me}`, `/api/health` | Native H3 | ForgeCMS `handleLogin`/`handleLogout`/`handleMe`; untouched by Strata                            |

ForgeCMS keeps: content model, access rules, validation, sessions, adapters, envelope. Strata keeps: controller
lifetime and routing, Server Component compilation/rendering, islands, navigation, SSR failure, build identity,
server-only enforcement. No rule is duplicated in a controller or component; `EditorialService.canChangeStatus` is a
**UI hint** mirroring the update rule (the server re-checks through ForgeCMS on every write).

## 5. Public Strata API used (and nothing else)

`@strata-sc/core`: `Controller`, `Get`, `Post`. `@strata-sc/analog`: `registerControllers` (`controllerFactory`,
`guards`, `interceptors`, `apiBoundary`), `StrataAnalogRequest`/`Guard`/`Interceptor`/`NitroRouter` types.
`@strata-sc/server-components`: `ServerComponent`, `StrataClientBoundary`, `provideSkewRecovery`,
`provideStrataHydrationObserver`; `/vite` `strataServerComponents` (with `buildId`); `/navigation`
`StrataDocumentLink`, `StrataDocumentNavigator`, `strataDocumentNavigationGuard`; `/ssr`
`withStrataSsrFailureContract`, `provideStrataSsrFailureHandler`; `/server-only`. No deep import, no private
framework code, no patched dependency, no experimental streaming, no Angular DI in controllers.

## 6. Security architecture and evidence

- **Identity** only from ForgeCMS's session (`requireAuth` on the request's own headers). Query parameters,
  `x-user-id`, `x-forwarded-user` and forged bearers are ignored (tested).
- **Authorization** only by ForgeCMS access rules through the Local API (`overrideAccess: false`).
- **Isolation**: identity per request; one runtime per isolate holding infrastructure only; the controller is built
  per request; SSR context per render. 300 interleaved requests across 3 identities: **0 crossings** on Node and on
  workerd.
- **Not-found parity**: a hidden draft and a missing post give the same 404 page/status.
- **Caching**: signed-in → `private, no-store`, `Vary: Cookie, Authorization`; anonymous published → `public,
no-cache`. (A `max-age` first used here kept a **retracted** post visible for 60 s; the browser test caught it.)
- **CSRF**: ForgeCMS `assertCsrfSafe` in a Strata guard; cross-site and origin-less cookie mutations → 403.
- **Confidentiality**: browser output (20 files incl. 10 hidden maps) has no server marker, ForgeCMS server class,
  secret, password, email or draft canary; markers are proven present server-side; a planted server chunk is
  detected (positive control). Island props carry `{ articleTitle }` and `{ postId, initialStatus }` only.
- **Errors**: API `{"error":"Internal server error"}`; SSR generic 500 `no-store` via `/ssr`; logs carry error
  class names only (no path, secret, email or canary — asserted).
- **Negative controls**: weakened `read` and `update` rules are each detected by the policy matrix (the `update`
  control first exposed a gap in the test itself: the read rule masked it; fixed).

## 7. SSR, hydration, navigation (Chromium, production builds, retries off)

9/9 on Node and 9/9 on local workerd + D1: server DOM **reused** on hydration (node identity); JS-disabled read and
reload; a click queued before hydration replayed **exactly once**; **one** POST per action before and after
hydration; safe failure + recovery; cross-user draft absent from every browser response; conventional → Server
Component route is a **document** load (not SPA); Back/Forward/reload; login return via `StrataDocumentNavigator`;
open redirect refused; 404s. Stable over 4 consecutive Node runs.

**Product limitation (accepted, not hidden):** every hop into a Server Component route is a full document request
(`NO-SPA`). For an editorial desk this is acceptable; the desk list is a conventional route.

## 8. Node and Cloudflare

| Profile                             | Evidence                                                                                                                                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node `node-server` + durable libSQL | 44/44: isolation, CSRF, lifecycle, concurrency, p50 28 ms / p95 43 ms / max 50 ms (300 req, local), RSS 161→177→171 MB across two equal bursts, SIGTERM exit in 18 ms, DB-down → 503/500 safe, recovery without restart, refusal without a durable profile |
| Cloudflare Pages build              | `BUILD_PRESET=cloudflare-pages`; no `node:` imports in the Worker; compat date 2026-09-21, no flags                                                                                                                                                        |
| Local workerd + local D1            | 35/35 HTTP matrix (p50 35 ms / p95 51 ms), 9/9 Chromium; SSR reads D1 through the request-env seam                                                                                                                                                         |
| Deployed Pages endpoint             | **NOT RUN** (not authorized)                                                                                                                                                                                                                               |

These are local-process numbers on a developer machine and a hosted runner, not production SLO evidence.

## 9. Release, migration and rollback

`qualification/upgrade-rollback.ts` (12/12): release A → B → retained A on one durable database and secret with an
open Chromium session. An action started on an A document completes against B (one request); sessions survive both
switches; data written under B is served by rolled-back A; schema byte-identical (no migration); build identities
`rel-a`/`rel-b` distinct. **R-1:** Nitro `node-server` serves only its build-time asset manifest, so previous
hashed assets cannot be retained by copying files; a stale A document under B loses its scripts. Asserted to fail
**safe** (readable HTML, no cross-build hydration, no page error) and to recover on reload. Seamless retention needs
the static layer (CDN/object store) to keep old assets. No irreversible schema change exists; none is needed.

## 10. Findings

| Id      | Where                   | Severity              | Finding                                                                                                                                                                                                                                                                   |
| ------- | ----------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S-1** | Strata analog           | Medium (fails closed) | On Node, `StrataAnalogRequest.url` is `new URL(path, "http://localhost")`: its origin ignores Host/port/proto. An origin check (CSRF) against it refuses every legitimate same-origin mutation. Undocumented; differs from Pages. Repro: `tests/strata-findings.test.ts`. |
| **S-2** | Strata analog types     | Low (DX)              | `ControllerClass` is `new () => object`, but the README's `controllerFactory` example uses a required constructor argument; following it fails type-checking. Workaround: optional parameter that throws without the factory.                                             |
| R-1     | Deployment model        | Medium (operational)  | See §9.                                                                                                                                                                                                                                                                   |
| F-1     | ForgeCMS (fixed in app) | —                     | First user is provisioned admin regardless of requested role (documented ForgeCMS behaviour); the fixture now creates the admin first and asserts roles.                                                                                                                  |
| F-2     | ForgeCMS ergonomics     | Low                   | Sort/filter use column names (`updated_at`) while documents return `updatedAt`; the sort error says "filter field". Not changed here (stable surface).                                                                                                                    |
| F-3     | Consumer build          | —                     | libSQL's computed native `require` is invisible to Nitro's tracer; fixed with `traceInclude` in `vite.config.ts`.                                                                                                                                                         |

Neither S-1 nor S-2 is a Strata runtime defect requiring a code fix before RC; both need a separate, independently
reviewed Strata change (docs or behaviour), not a change in this PR.

## 11. Remaining blockers before this can count toward Strata 1.0 GA

1. Publish `1.0.0-rc.0`; switch the three pins; re-run every suite (local and hosted) on the RC tuple.
2. A real deployment of this consumer (authorized Cloudflare project or Node host) and a deployed qualification.
3. A real operational observation period with real users — see [OPERATIONAL-OBSERVATION.md](OPERATIONAL-OBSERVATION.md).
4. Strata decisions on S-1 and S-2; an operational answer to R-1 for the chosen host.
5. An existing (not new) application adopting Strata remains open; this report does not claim it.

## How to reproduce

See [README.md](README.md). Evidence JSON is written to `qualification/artifacts/` and uploaded by the
`Strata editorial consumer` workflow.
