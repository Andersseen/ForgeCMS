# 102 — Adopt the Strata RC in an independent ForgeCMS editorial consumer

- **Status:** in-progress
- **Author:** agent draft (implementation explicitly requested by the maintainer, 2026-11-07)
- **Date:** 2026-11-07
- **Branch:** `feat/strata-rc-real-consumer-adoption`
- **Affected packages/apps:** new `consumers/strata-editorial` (outside the pnpm workspace), new
  `.github/workflows/strata-editorial.yml`. **No `packages/*` change, no changeset, no public API change.**

## Context / Why

Strata (`@strata-sc/core`, `@strata-sc/analog`, `@strata-sc/server-components`) is entering its 1.0 RC line.
Its GA checklist keeps four "real application" requirements open: they need a meaningful consumer outside
Strata's own fixtures. ForgeCMS already consumed Strata 0.1 controllers in `apps/tiny-project` (2026-09-25), but
on Angular 21 / Vite 7. Strata's RC support contract is one exact framework tuple (Angular 22.2.3, Analog 2.7.2,
Vite 8.3.0, Nitro 2.13.4, H3 1.15.11) and refuses duplicated Angular installs (`NO-DUPLICATES`).

## Goal

A meaningful ForgeCMS application uses the Strata tuple through Strata's supported public contracts, qualified as
a production build on Node and on local workerd, with the remaining operational evidence explicitly identified.

## Non-goals

- Upgrading the monorepo (or any existing app) to Angular 22 / Vite 8.
- Changing any `@forge-cms/*` package, API envelope or compatibility guarantee.
- Replacing ForgeCMS's HTTP architecture: native H3 routes stay; Strata only adds routes.
- Editing Strata (source, CI, release checklist). Findings are reported for separate Strata work.
- Claiming RC adoption before `1.0.0-rc.N` is on npm, or operational adoption without real use.
- Deploying anything (no Cloudflare project is created; no production deployment is touched).

## Design

**Boundary (decision B of the brief).** In-place integration (A) would put Angular 22 / Vite 8 into a workspace
whose catalog pins Vite 7.1.4 and whose `@forge-cms/admin` peers on Angular `^21` — a duplicated-Angular
install outside Strata's contract and a risk to deployed apps. Instead: `consumers/strata-editorial`, its own
`pnpm-workspace.yaml` and lockfile, installing **published** `@forge-cms/{core,db,auth,runtime,storage,api,cloudflare}`
`1.0.0` (framework-agnostic server packages, no Angular peer) and the exact Strata framework tuple.

**Strata version.** `1.0.0-rc.0` is not published (2026-11-07: PR #182 entered the RC line and was reverted by
PR #183 the same morning; Strata `main` is not in pre mode).
The consumer pins the published RC0 baseline (core 0.2.2 / analog 0.12.1 / server-components 0.17.0, the
candidate COMPATIBILITY.md freezes for RC0) and `scripts/verify-strata-tuple.mjs` classifies the install
(exit 0 published RC, 2 pre-RC rehearsal, 1 invalid). Moving to the RC is a three-line pin change.

**Ownership.** ForgeCMS: content model (`users`, `posts` with drafts and an author relation), access rules,
session/auth (`UsersCollectionAuthAdapter`, `handleLogin`/`handleLogout`/`handleMe`), database adapters
(libSQL on Node, D1 on Pages), `assertCsrfSafe`, the `{ data }`/`{ data, meta }`/`{ error }` envelope.
Strata: the `/api/editorial` controller (request-scoped, factory-built, explicit dependencies, no Angular DI),
the `post-document` Server Component, two `[strataClient]` islands, document navigation, the opt-in `/ssr`
failure contract, build identity with bounded skew recovery, server-only graph enforcement.

**Single service.** `EditorialService` is the only place request identity meets the Local API: identity from the
session headers only, every read/write with `overrideAccess: false`. Controller and Server Component both
delegate to it; neither contains a rule.

**Request state.** SSR receives `{ headers, env }` through Angular `REQUEST_CONTEXT` per render (Strata's
documented seam). On Pages, a Nitro `request` hook attaches the bindings to the request's own object, read back
from Analog's public `REQUEST` token. One ForgeCMS runtime per isolate (`Symbol.for` store, because Strata
documents that the Nitro and SSR bundles evaluate separate module copies); it holds no request state.

**Security contract.** Anonymous: published only. Editor: published + own drafts; may change only own posts.
Admin: everything. Viewer: published only, no writes. A hidden draft answers the same 404 as a missing post.
Mutations: CSRF origin check (guard) → session → validation → ForgeCMS update access. Documents for a signed-in
caller are `private, no-store` + `Vary: Cookie, Authorization`; anonymous published HTML and the public list are
`public, no-cache` (retraction is immediate). Errors are generic; logs carry error class names only.

## Implementation plan

- [x] Isolated consumer, exact tuple, tuple classifier.
- [x] CMS layer (collections, durable-profile runtime, `EditorialService`), controller + plugin, native routes.
- [x] Server Component route with guard, conventional desk/login routes, islands, `/ssr` contract, build identity.
- [x] Policy matrix + negative controls, leak scan + positive control, Strata finding reproduction.
- [x] Node production qualification; Chromium e2e on Node and on local workerd + D1; workerd HTTP matrix.
- [x] Upgrade/rollback rehearsal; CI workflow; adoption report, Strata evidence, observation plan; STATE.md.
- [ ] Re-run everything on the published `1.0.0-rc.N` tuple (blocked: not published).
- [ ] Operational observation period (blocked: no real deployment or users authorized).

## Test plan

`consumers/strata-editorial`: `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm qualify:leaks`,
`pnpm qualify:node`, `pnpm e2e`, `pnpm qualify:upgrade`, `pnpm build:cloudflare`, `pnpm e2e:workerd`,
`pnpm qualify:workerd`; hosted: `.github/workflows/strata-editorial.yml`. Repository gates unchanged and green.

## Acceptance criteria

1. The consumer installs with `--frozen-lockfile`, one `@angular/core` (22.2.3), framework tuple = RC contract.
2. All suites above pass locally and in the hosted workflow, retries off.
3. Negative controls prove the policy matrix and leak scan detect a weakened rule and a planted server chunk.
4. No `packages/*` file changes; `pnpm lint && pnpm typecheck && pnpm test && pnpm build` and
   `pnpm format:check` green at the repository root.
5. Report states the RC is unpublished and operational adoption is NOT RUN; no GA criterion is claimed.

## Open questions

- Whether this consumer should later be promoted to a deployed staging application (needs a maintainer decision
  and a Cloudflare project; see `consumers/strata-editorial/OPERATIONAL-OBSERVATION.md`).

## Outcome

Pending merge. Implemented on the RC0 baseline tuple; qualified as a rehearsal. See
`consumers/strata-editorial/ADOPTION-REPORT.md`.
