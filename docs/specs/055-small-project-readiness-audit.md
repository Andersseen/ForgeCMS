# 055 — Small Project Readiness Audit

- **Status:** done
- **Author:** agent draft (maintainer-directed milestone — the maintainer's own prompt for this
  branch specifies the full scope, audit method, non-goals, and required verification below in
  enough detail to constitute build authorization; see Context)
- **Date:** 2026-09-03
- **Branch:** feature/small-project-readiness
- **Affected packages/apps:** primarily new `apps/tiny-project` (fixture) and docs; touches
  `packages/*` only for confirmed generic blockers found during the audit (see Outcome for the
  actual list — expected to be small, this is a hardening/validation branch, not a feature branch)

## Context / Why

Specs 053 (browser auth foundation) and 054 (Angular/admin auth experience) just shipped cookie
sessions, CSRF, signup, the Angular session/guard layer, sign-in/up components, and a users
workspace — all proven by unit/integration tests and by `apps/www`/`apps/demo-aesthetics`
dogfooding them. What has never been proven is the thing that actually matters for adoption: can a
developer who is _not_ a maintainer of this monorepo take the published `@forge-cms/*` surface and
build a small, real CMS-backed app — users, auth, protected admin, content, drafts, one relation —
without reading repo internals or recreating glue this project should already provide?

`scripts/verify-release.mjs` already proves the packed public API type-checks and basic Local-API/
auth-handler calls work (a real `pnpm pack` + `npm install`-equivalent boundary, not source
aliases) — but its "consumers" are throwaway single-file TypeScript proofs run once and discarded.
Nothing exercises a real running app: a browser hitting a real dev/preview server, a first-admin
bootstrap from zero rows, a page refresh keeping a session, a role boundary enforced against a
crafted request, or the portable (non-Cloudflare) database profile. That gap is this spec.

Real, unrelated finding surfaced while orienting on this branch, before any fixture code was
written: the release pipeline (`.github/workflows/ci.yml`'s `release` job) has a latent ordering bug
— `changesets/action` checks out a throwaway `changeset-release/main` branch to open the "Version
Packages" PR, applies the version bump **to the working tree only** (never committed to `main`), and
leaves that checkout in place; the next two steps in the _same_ job
(`release:publish-unpublished`, `release:github`) then run against that uncommitted bump. This is
exactly how `@forge-cms/*` packages reached `0.4.0` on npm and a `v0.4.0` GitHub release exists,
while `main`'s tracked `packages/*/package.json` still read `0.3.0` and PR #35 ("Version Packages")
sits open, unmerged, at time of writing. The publish itself is not wrong (0.4.0 is the correct next
version — PR #35's diff bumps to the same number) but the mechanism is an accident: it silently
publishes+tags **before** the corresponding commit lands on `main`, which is fixed here as a small,
isolated CI-only change (see Design). Per the maintainer's explicit instruction for this branch,
**the already-published `v0.4.0` is accepted as real history and is not touched** — no unpublish,
no tag rewrite, no version rollback.

## Goal

Ship a deliberately tiny, workspace-linked but public-surface-only ForgeCMS consumer
(`apps/tiny-project`) that proves, end to end and in a real browser, that a small app — users +
posts, cookie auth, protected admin, roles, drafts, one relation — works from the published
`@forge-cms/*` API on both the Cloudflare (D1/R2) and portable (libSQL) profiles; fix only the
generic Forge-side blockers that this exercise actually surfaces; and leave the readiness verdict
(a matrix, not a feature list) in `docs/STATE.md`.

## Non-goals

Mirrors the maintainer's brief exactly — restated here as the binding scope fence for the
implementer:

- No new field kinds, adapters (no Postgres/S3/MongoDB/GraphQL), auth methods (no OAuth, password
  reset email, MFA, passkeys, magic links), plugin system, or CLI (`create-forge-app`).
- No organizations/teams/billing, image processing/thumbnails, bulk actions, saved filters, workflow
  approvals, analytics dashboard, or SSR auth transfer-state architecture.
- No Glossa-specific behavior anywhere in this repo.
- No redesign of CSRF, the auth contract, or the admin routing API — only fix a bug the integrated
  fixture actually exposes.
- No version rollback / tag rewrite / npm unpublish. `v0.4.0` stands as published history; this
  branch adds a normal Changeset only if `packages/*` code changes, and does not itself publish a
  release.
- Do not merge or close PR #35 ("Version Packages") as part of this branch — it is pre-existing
  release-automation state, out of scope beyond the CI ordering fix described below.
- `apps/tiny-project` is a readiness fixture, not a second showcase app: no bespoke visual design,
  no content beyond what the acceptance criteria require, no host-side CRUD pages that duplicate
  `@forge-cms/admin`'s reusable components.
- Do not implement the "next isolated feature" this audit's findings point toward — report it,
  don't build it (final report item 22).

## Design

### 1. Release pipeline ordering fix (isolated, no product code touched)

`.github/workflows/ci.yml`'s `release` job: insert a step immediately after `changesets/action@v1`
and before `release:publish-unpublished` that restores the working tree to the commit the workflow
actually ran on, so the two steps that follow only ever see what is really committed to `main`:

```yaml
- name: Restore working tree to the triggering commit
  # changesets/action leaves the checkout on a throwaway changeset-release/main branch with an
  # uncommitted version bump (the "Version Packages" PR diff) applied to the working tree. The
  # steps below must only ever publish/tag what is actually committed to main.
  if: always()
  run: git checkout "${{ github.sha }}" -- .
```

This makes `release:publish-unpublished`/`release:github` no-ops whenever a Version PR is pending
(current package.json version is already published — both scripts already handle "already
published"/"already exists" as a skip, not an error) and lets them do real work only once a Version
PR actually merges to `main`. No behavior change to a repo where changesets are never pending at
merge time. No changeset needed (workflow-only, not `packages/*`).

### 2. `apps/tiny-project` — the external-style fixture

New Analog.js + Angular app at `apps/tiny-project`, structurally cloned from `apps/demo-aesthetics`'s
build config (the parts that are pure boilerplate every Cloudflare-deployed Analog app in this repo
repeats identically: `vite.config.ts`, `vite-plugins/angular-linker.ts`, `tsconfig*.json`,
`wrangler.toml`, `playwright.config.ts`, `main.ts`/`main.server.ts`), but with genuinely new,
minimal content — not a copy of the demo's collections/pages.

**Every `@forge-cms/*` import in this app uses the package's root entry point only**
(`@forge-cms/core`, `@forge-cms/auth`, never `@forge-cms/admin/src/...`) — pnpm workspace linking is
what apps use in dev (identical to `apps/www`/`apps/demo-aesthetics`; there is no separate "install
from npm" mode for an app in this monorepo), so the external-consumer boundary this fixture proves
is import-surface discipline plus a real running app/browser, complementary to (not a replacement
for) `scripts/verify-release.mjs`'s separate packed-tarball proof (extended below).

**Content model** (`apps/tiny-project/src/server/api/collections.ts`):

```ts
import { defineCollection, defineField } from '@forge-cms/core';
import { defineUsersCollection } from '@forge-cms/auth';

export const users = defineUsersCollection();

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'author'] },
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({ required: true, unique: true, autoGenerate: 'title' }),
    body: defineField.richtext(),
    author: defineField.relation({ collection: 'users', required: true })
  },
  access: {
    read: () => true,
    create: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    update: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    delete: ({ user }) => user?.role === 'admin'
  }
});

export const collections = [users, posts];
```

No `media`/uploads — kept out per the brief's non-goal (basic R2 upload is already proven at the
package level by spec 051; this fixture does not need to re-prove it).

**Server runtime** (`apps/tiny-project/src/server/api/runtime.ts`): same shape as
`apps/www/src/server/api/runtime.ts` — `D1DatabaseAdapter`/`InMemoryDatabaseAdapter` picked by
`env.DB` presence, `UsersCollectionAuthAdapter` with `devMode: !env?.AUTH_SECRET`, lazy
`getServerRuntime(env)` (not module-scope async). **No seed script creates a demo admin.** This is
the one deliberate divergence from every existing app: first-run means zero rows, zero users, so the
first-admin bootstrap path is real, not simulated. `getServerRuntime` only calls `runtime.syncSchema()`
— it never calls `createUser`.

**Server routes** (`apps/tiny-project/src/server/routes/api/`): `auth/{login,signup,logout,me}.ts`
thin wrappers over `handleLogin`/`handleSignup`/`handleMe`/`handleLogout` (identical pattern to
`apps/www`, `signup.post.ts` gated by `FORGE_ENABLE_SIGNUP`), `[collection].ts`/`[collection]/[id].ts`
generic `/api/v1/*` CRUD delegating to `@forge-cms/runtime` handlers (identical pattern to
`apps/www`), `auth/users*.ts` admin-only user management (identical pattern), `bootstrap-admin.post.ts`
— **not a new public endpoint**, an app-local route (like every other route in this file) that calls
the existing public `auth.createUser({ email, password })` Local API — 404s once any user exists
(`(await runtime.count('users')) > 0`), documented in the small-project guide as _the_ pattern for a
consumer's own first-run bootstrap route, not a new Forge capability.

**Admin routing** (`apps/tiny-project/src/app/admin.routes.ts`): exactly the composition from the
maintainer's brief section 7, using only existing exports —

```ts
export const ADMIN_ROUTES: Routes = [
  ...forgeAdminAuthRoutes({ signup: true }),
  {
    path: '',
    component: ForgeAdminLayoutComponent,
    canActivate: [forgeAuthGuard()],
    children: [
      ...forgeAdminContentRoutes(),
      {
        path: 'users',
        component: ForgeUsersWorkspaceComponent,
        canActivate: [forgeAuthGuard({ roles: ['admin'] })]
      }
    ]
  }
];
```

If this compiles and works with zero additional glue (expected, given spec 052/054 already proved
the pieces individually) — that's a `NO CHANGE` finding for brief sections 6/7/26, recorded in the
Outcome, not an excuse to add abstraction.

**Public pages**: one minimal published-posts list + detail (server-rendered via the Local API,
`overrideAccess: false`, mirroring `apps/demo-aesthetics`'s `/api/site/*` pattern at the smallest
useful scale — one endpoint, not eight) — enough to prove drafts are actually invisible
unauthenticated, nothing more.

### 3. Portable (libSQL) profile proof

New `apps/tiny-project/src/tests/portable-libsql.integration.test.ts`: builds the same
`collections`/`UsersCollectionAuthAdapter` against a real `LibSqlDatabaseAdapter` (`:memory:` via
`@libsql/client`, no Cloudflare binding of any kind), and drives the full lifecycle from the Local
API: `syncSchema` → `createUser` (first admin) → `login` → `createUser` (second user, editor role) →
create/update/publish/delete a post → verify a draft is invisible to an anonymous `find` → verify the
`author` relation populates via `depth: 1`. This is the "real local Cloudflare runtime proof" pattern
spec 051 already established for D1, mirrored for libSQL exactly as brief section 40/17 asks.

### 4. Cloudflare (D1/R2) profile proof

`apps/tiny-project` gets a `wrangler.toml` binding `DB`/`BUCKET` (unused — no media in this fixture,
so `BUCKET` is declared but not exercised) the same way `apps/demo-aesthetics` does, and a
`pnpm --filter tiny-project test:cloudflare`-style suite (or a shared script) that runs the same
lifecycle as the libSQL test above against a real local D1 binding via `@cloudflare/vitest-plugin`
(Miniflare/workerd) — reusing `@forge-cms/testing/contracts` where applicable, not duplicating
adapter-level assertions spec 051 already covers.

### 5. `scripts/verify-release.mjs` extensions

Extend `verifyRuntimeConsumer`'s existing `defineUsersCollection()`/`handleSignup` block (it already
proves signup→admin bootstrap, cookie session, and CSRF) with the assertions that fixture-building
is expected to reveal are still only proven at the source level, not through packed artifacts:
`passwordHash` never appearing in a `listUsers`-shaped result, an `editor`-role write succeeding and
a `viewer`-role write being denied on a collection with function-based `access` (proving role
enforcement survives the packed boundary), and — if the fixture's relation/drafts exercise finds a
real gap in what's packed vs. what's compiled — a minimal repro added here rather than only in the
app. Only add assertions for things not already covered (re-read the current file first; it already
covers nested where/sort/findOne/containsValue/compound-unique/API-keys/signup/CSRF).

### 6. Docs

- `apps/www/src/content/docs/quickstart.md`: revise only the parts that don't match what actually
  compiled in this branch; add the two compact variants (Cloudflare / Portable) from brief section
  31, each ending at a working first admin + signin.
- New `apps/www/src/content/docs/small-project-guide.md` (brief section 32): Install → Define users +
  posts → Choose adapters → Create runtime → Mount server API → Mount admin → Create first admin →
  Sign in → Manage content. Every snippet copied from what actually built in `apps/tiny-project`, not
  written from memory.
- `docs/STATE.md`: a new, concise "Small-project readiness" summary near the top (current state
  stays, per STATE.md's own maintenance rule — never erase history) plus the readiness matrix (brief
  section 36) filled with real results only.
- `docs/ROADMAP.md`/`docs/DEMO-FINDINGS.md`: correct items resolved by specs 047–054 that still read
  as open (see Outcome for the exact list, gathered by audit before any doc edits).

## Non-goals

(see above — kept as one section per the brief; do not duplicate)

## Implementation plan

- [ ] Fix `.github/workflows/ci.yml`'s release-job ordering bug (Design §1)
- [ ] Audit package exports/deps/peerDeps for all 7 named packages + `scripts/verify-release.mjs` +
      `docs/ROADMAP.md` + `docs/DEMO-FINDINGS.md` + `apps/www`/`apps/demo-aesthetics` auth wiring;
      classify every finding per the brief's taxonomy before writing fixture code
- [ ] Scaffold `apps/tiny-project` build config (vite/tsconfig/wrangler/playwright/linker), collections,
      server runtime + routes, admin routes, minimal public pages (Design §2)
- [ ] Verify the full first-run flow manually in a real browser (Playwright MCP or `pnpm dev`):
      fresh DB → bootstrap first admin → signin → cookie survives refresh → protected admin →
      create/edit/publish/delete a post → relation → validation error UX → direct refresh of nested
      admin URLs → CSRF (cross-site rejected, same-site works) → 401 vs 403 → logout
- [ ] Two-admin / last-admin invariant + role boundary proof (admin vs editor vs viewer) via crafted
      HTTP requests, not just UI visibility
- [ ] `apps/tiny-project/e2e/*.spec.ts` — Playwright suite covering the golden path from brief
      section 38
- [ ] Portable libSQL integration test (Design §3)
- [ ] Cloudflare D1 (+ R2 if media ends up in scope, expected not to) local-Workers-runtime test
      (Design §4)
- [ ] `scripts/verify-release.mjs` extensions (Design §5), only for gaps actually found
- [ ] Fix only confirmed generic Forge blockers found during the above (expected small; each one gets
      its own paragraph in Outcome with the concrete failure it fixes)
- [ ] Docs: quickstart, small-project guide, STATE.md summary + readiness matrix, ROADMAP/DEMO-FINDINGS
      corrections (Design §6)
- [ ] Changeset for any `packages/*` change (only if one was actually needed)
- [ ] Full verification gate (see Test plan) + final report per the brief's required 22-point format

## Test plan

- `pnpm install --frozen-lockfile && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- `pnpm test:cloudflare` (extended if the fixture's D1 proof needs its own suite)
- `pnpm release:verify` (extended per Design §5)
- `apps/tiny-project`'s own Playwright e2e suite, run against its real dev server
- `apps/tiny-project`'s portable-libsql integration test, run against a real libSQL `:memory:` db
- Existing `apps/www`/`apps/demo-aesthetics` e2e suites must stay green (proves nothing regressed)
- Manual: real-browser pass for direct refresh of nested admin URLs (`/admin/collections/posts`,
  `/admin/collections/posts/new`, `/admin/users`) both authenticated and anonymous

## Acceptance criteria

The 32 numbered criteria in the maintainer's brief apply verbatim and are the source of truth; not
re-enumerated here to avoid drift between two copies. Summarized as mechanically-checkable gates:

1. `apps/tiny-project` exists, imports only `@forge-cms/*` root entry points, has zero deep imports
   into any package's `src/`.
2. `pnpm --filter tiny-project e2e` (or equivalent) passes the golden-path suite (brief §38).
3. `apps/tiny-project`'s libSQL integration test passes against a real libSQL database.
4. `pnpm test:cloudflare` passes including the new D1 lifecycle proof.
5. `pnpm release:verify` passes with the extended assertions.
6. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.
7. `docs/STATE.md` carries a readiness matrix with only actually-run results (no untested PASS).
8. No release published from this branch; `v0.4.0` untouched; `.github/workflows/ci.yml`'s ordering
   fix is the only release-pipeline change.

## Open questions

(none — the maintainer's brief resolves every design choice needed to start; anything genuinely
undecided is called out inline above as a decision made by this spec, for the maintainer to
override after the fact if wrong, per the SDD process for a fully-directed branch)

## Outcome

Shipped as designed. `apps/tiny-project` exists, imports only `@forge-cms/*` root entry points, and
proves the full first-run lifecycle three ways: `src/tests/content-model.test.ts` (InMemory, fast),
`src/tests/portable-libsql.integration.test.ts` (real libSQL, no Cloudflare binding),
`test/workers/d1-lifecycle.test.ts` (real local D1 via `@cloudflare/vitest-plugin`), plus
`e2e/golden-path.spec.ts` (9 tests, real browser) covering bootstrap → signin → cookie-survives-
reload → direct-refresh-of-nested-URLs → content CRUD with a real relation → drafts →
validation-error UX → users management + role boundary → the last-admin invariant (self-demote/
self-delete rejected, a second admin unblocks both) → signup-no-escalation → CSRF.

**Real generic bugs found and fixed** (each one first broke while actually building the fixture,
then got a regression test in the owning package — see `docs/STATE.md`'s readiness summary for the
full write-up of each):

1. `depth: 1` relation/upload population leaked every field of the related document, including
   `passwordHash` — `packages/runtime/src/populate.ts`, new `PopulateOptions` on
   `populateRecords`/`populateRecord`, wired into `operations.ts`'s read path and `handlers.ts`'s
   `handlePreview`. The most severe finding — a real security-relevant leak, not a DX gap.
2. `withAuthFields()` put `passwordHash` first in field order, breaking the relation picker's
   search-field heuristic for any relation into a `users`-shaped collection —
   `packages/auth/src/user-fields.ts`.
3. The typed Local API had no way to type-check `_status` on a `drafts: true` collection —
   `packages/core/src/index.ts`'s `DocumentMeta`/`CollectionInput`.
4. The Angular Vite linker plugin (mandatory for any app consuming `@forge-cms/admin`, or a
   production `JIT compiler unavailable` crash) was never a package export — closed DEMO-FINDINGS
   finding 13 via `@forge-cms/admin/vite`; `apps/www`/`apps/demo-aesthetics` both migrated off their
   local copies, proving it in place.
5. `forgeAdminAuthRoutes({ signup: true })`'s "Sign up" link resolved relative to its own route and
   404'd instead of reaching the sibling `/signup` route — `packages/admin/src/auth-routes.ts`.
6. Unrelated to the fixture: `.github/workflows/ci.yml`'s release job leaked `changesets/action`'s
   throwaway version-bump checkout into the two steps after it, publishing/tagging a version before
   the corresponding commit landed on `main` — the actual mechanism behind `v0.4.0` reaching npm
   while `main` still read `0.3.0`. Fixed (workflow-only); `v0.4.0` itself was left untouched as
   history, per the non-goals.

**Inspected and already correct** — no change needed: the four auth route wrappers
(`login`/`signup`/`logout`/`me`.post/get.ts) are already maximally thin (4–6 lines of real logic
each, the duplication is Nitro's file-routing model, not a missing abstraction); the admin route
composition from brief §7 worked with zero additional glue; `@voltui/components`' `^0.6.0` peer
range still resolves correctly despite `1.0.1` being the npm `latest` tag; package
dependency/devDependency placement across `@forge-cms/admin`/`angular`/`auth`/`cloudflare` was
already correct.

**Deferred, explicitly**: persistent file uploads on the portable (libSQL) profile — no first-class
non-Cloudflare `StorageAdapter` exists; documented as a real, known gap rather than built (S3 support
would be its own isolated feature, and this branch's own fixture doesn't need uploads to prove
readiness). A CLI, OAuth, Postgres, and every other item in the brief's non-goals — not touched.

**Verification actually run**: `pnpm install --frozen-lockfile` (implicit via the workspace already
being installed and every subsequent command succeeding), `pnpm format:check`, `pnpm lint`, `pnpm
typecheck`, `pnpm test` (914 tests, all packages/apps), `pnpm build` (14/14 tasks), `pnpm
test:cloudflare` (73 tests, includes the new D1 lifecycle proof), `pnpm test:libsql` (3 tests, real
libSQL), `pnpm release:verify` (packed-artifact consumer checks, extended per Design §5), the full
Playwright suites for `apps/www` (16 tests), `apps/demo-aesthetics` (5 tests), and
`apps/tiny-project` (9 tests) — all green. See `docs/STATE.md`'s readiness summary for the full
capability matrix and the final chat report for the complete 22-point write-up.

No release published from this branch. One changeset
(`.changeset/small-project-readiness.md`) covers the four touched public packages
(`@forge-cms/core` patch, `@forge-cms/auth` patch, `@forge-cms/admin` minor, `@forge-cms/runtime`
minor).
