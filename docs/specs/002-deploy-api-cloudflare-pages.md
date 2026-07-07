# 002 — Deploy the API to Cloudflare Pages (server build)

- **Status:** done
- **Author:** agent draft
- **Date:** 2026-07-07
- **Branch:** main
- **Affected packages/apps:** apps/www, root (`wrangler.toml`, `.github/workflows/*`)

## Context / Why

PLAN.md P1-1 — the deployed site is currently client-only static files (`analog({ ssr: false })`,
deploy workflow uploads only `apps/www/dist/client`), so the online `/admin` has no `/api/*` and
cannot load data. STATE.md known issue #0.

This spec was investigated empirically (not just read from docs) before being written: I built
`apps/www` locally with `BUILD_PRESET=cloudflare-pages`, ran the output under `wrangler pages dev`
(real workerd runtime, not Node), and hit the actual HTTP endpoints. Findings below are verified,
not assumed.

### Finding 1 — the Nitro server is already built today

`apps/www/vite.config.ts` only sets `analog({ ssr: false })`. Despite `ssr: false`, a full Nitro
server already gets built on every `pnpm build:www` at `apps/www/dist/analog/server` — confirmed by
inspecting the current build output. `ssr: false` only skips SSR page rendering (Angular pages are
prerendered as static HTML instead); it does **not** disable bundling the API routes into a server.
So `ssr: false` can stay as-is — non-goal to touch it.

### Finding 2 — the Cloudflare Pages preset needs one config line, output moves to `dist/analog/public`

Setting `nitro: { preset: 'cloudflare-pages' }` (or env `BUILD_PRESET=cloudflare-pages`, which
`@analogjs/vite-plugin-nitro` checks first) makes Analog's own preset-detection
(`isCloudflarePreset`) redirect the server bundle's output to
`{{ output.publicDir }}/_worker.js` — and Nitro's `copyPublicAssets` step already copies the client
SPA build into `output.publicDir` (verified: `dist/analog/public` is byte-identical to `dist/client`
today). Net effect: after this change, **`apps/www/dist/analog/public` is the single directory**
containing the static site *and* a `_worker.js/` subdirectory with the compiled API server
(Cloudflare Pages "Advanced Mode" convention — a `_worker.js` directory works the same as a single
file). No `.output/` or other nitro-default paths are involved; Analog's own directory layout is used
throughout.

No nested `wrangler.json` gets written into the output dir (`writeWranglerConfig` only fires if we
opt into `nitro.cloudflare.deployConfig`, which we won't) — the existing root `wrangler.toml` stays
authoritative.

Cosmetic gap (confirmed, not a functional blocker): Nitro's cloudflare-pages preset writes
`_routes.json`, `_headers`, `_redirects` to `dist/analog/` (the parent of `public/`), not inside
`dist/analog/public/` itself, so they won't be picked up by a deploy of the `public` directory. This
only affects the invoke-worker-for-every-request-vs-skip-for-static-assets optimization and
cache-control headers — the worker itself already checks `isPublicAssetURL()` and proxies to
`env.ASSETS.fetch()` for static paths (verified in `nitropack`'s `cloudflare-pages.mjs` runtime
entry), so correctness does not depend on these three files. **Non-goal**: fixing their placement:
Copying them isn't required for a working demo; flagged as a known cosmetic gap, follow-up if
desired.

### Finding 3 — no Node-only APIs block bundling for workerd

Grepped `packages/*/src` and `apps/www/src/server` for `node:` imports: none. `@libsql/client`
(Node-native, unused at runtime since `apps/www` wires `InMemoryDatabaseAdapter`) does **not** end
up in the built worker bundle — confirmed by inspecting the built `_worker.js` output; Rollup tree-shakes
the unused `LibSqlDatabaseAdapter` export cleanly.

### Finding 4 (critical, must fix) — module-top-level seeding crashes on Workers

`apps/www/src/server/api/runtime.ts` seeds demo data with a fire-and-forget call at **module top
level**: `void seedData(runtime)`, and exports `serverRuntimePromise = Promise.resolve(runtime)`
(not awaiting the seed). `seedData` calls `db.create(...)`, which calls `crypto.randomUUID()`
synchronously with no `await` anywhere in `InMemoryDatabaseAdapter.create`.

Verified by running the actual built worker under `wrangler pages dev`:
- **As-is today**: the unawaited `seedData()` promise rejects immediately with `Disallowed operation
  called within global scope. Asynchronous I/O ... are not allowed within global scope` (a hard
  Cloudflare Workers runtime rule — no I/O/random/timers outside a request handler). Because nothing
  awaits it, the rejection is silently swallowed. Result: **every collection is permanently empty on
  Workers** — `GET /api/status` reports `records: 0` on every request, `GET /api/v1/posts` returns
  `[]`, consistently, across multiple requests in the same running isolate. (Local Node dev is
  unaffected — confirmed `records: 6` there — because Node has no such restriction, so this bug is
  invisible in `pnpm dev:www` and would only surface once deployed.)
- If `serverRuntimePromise` is instead made to *await* the seed at module scope (the "obvious" fix),
  every request 500s instead, because the same disallowed-operation error now propagates instead of
  being silently swallowed.
- **The fix that works**: make seeding lazy, triggered from inside a request handler instead of
  module scope, so `crypto.randomUUID()` only ever runs during an actual request. Verified with
  `wrangler pages dev`: after this change, `GET /api/status` reports `records: 6` consistently across
  repeated requests, and `GET /api/v1/posts` / `GET /api/v1/pages` return the seeded documents.

## Goal

`curl https://<deployed>/api/status` returns the JSON envelope on the real deployed Cloudflare Pages
site, `/admin` loads real (seeded) collections and documents online, and the CI deploy workflow stays
green.

## Non-goals

- Real (D1) persistence — still in-memory per isolate; data can reset on cold start. That's P2-1.
- Fixing `_routes.json`/`_headers`/`_redirects` placement (Finding 2's cosmetic gap).
- Any change to `ssr: false`, page rendering/prerendering behavior, or the API envelope/handlers
  themselves (QW-4's `coerceWhere` etc. is untouched).
- Auth — the API stays intentionally open (P2-2).

## Design

### 1. Lazy runtime initialization (`apps/www/src/server/api/runtime.ts`)

Replace the eager, module-scope seed with a lazy, request-triggered one. Keep the collections/adapter
setup and `runtime.init()` at module scope (synchronous, no I/O — safe at global scope); only the
seeding call moves:

```ts
runtime.init();

let seedPromise: Promise<void> | undefined;

/** Lazily seeds demo data on first call. Must only be invoked from within a request handler —
 *  Cloudflare Workers forbids async I/O (incl. crypto.randomUUID) at module/global scope. */
export function getServerRuntime(): Promise<ForgeCmsRuntime> {
  if (!seedPromise) {
    seedPromise = seedData(runtime);
  }
  return seedPromise.then(() => runtime);
}
```

Remove the old `export const serverRuntimePromise = Promise.resolve(runtime);` and the top-level
`void seedData(runtime);` call.

### 2. Update all 9 call sites

Every file that does `import { serverRuntimePromise } from '.../runtime'; ... await
serverRuntimePromise` switches to `import { getServerRuntime } from '.../runtime'; ... await
getServerRuntime()`:

- `apps/www/src/server/middleware/auth.ts`
- `apps/www/src/server/routes/api/status.get.ts`
- `apps/www/src/server/routes/api/auth/me.get.ts`
- `apps/www/src/server/routes/api/v1/collections.get.ts`
- `apps/www/src/server/routes/api/v1/[collection].get.ts`
- `apps/www/src/server/routes/api/v1/[collection].post.ts`
- `apps/www/src/server/routes/api/v1/[collection]/[id].get.ts`
- `apps/www/src/server/routes/api/v1/[collection]/[id].put.ts`
- `apps/www/src/server/routes/api/v1/[collection]/[id].delete.ts`

Update `docs/CONVENTIONS.md`'s line "Shared server state via the `serverRuntimePromise` singleton" to
say `getServerRuntime()`.

### 3. Vite/Nitro config (`apps/www/vite.config.ts`)

```ts
plugins: [analog({ ssr: false, nitro: { preset: 'cloudflare-pages' } }), tailwindcss(), tsconfigPaths()],
```

### 4. `wrangler.toml`

```toml
pages_build_output_dir = "apps/www/dist/analog/public"
```

### 5. Deploy workflow(s) — consolidation decision needed

**Found a pre-existing issue not previously documented**: there are *two* GitHub Actions workflows
that both deploy on every push to `main` — `.github/workflows/deploy-cloudflare.yml` ("Deploy WWW to
Cloudflare Pages": gates on its own `checks` job — format, lint, typecheck, test, e2e — before
deploying) and `.github/workflows/deploy.yml` ("Deploy": builds and deploys with **no test gate at
all**). Both currently upload `apps/www/dist/client`. They run as independent workflows (no shared
concurrency group) so both fire on every push, racing each other, and the ungated one could deploy a
build that the gated one's checks would have failed.

**Recommendation (approved)**: keep `deploy-cloudflare.yml` (it's the safer, self-gating one) with its
upload path updated to `apps/www/dist/analog/public`, and delete `deploy.yml`.

In `deploy-cloudflare.yml`, change the `Verify build output` step's checked path to
`apps/www/dist/analog/public/index.html` and the `wrangler pages deploy` path to
`apps/www/dist/analog/public`.

## Implementation plan

- [x] `apps/www/src/server/api/runtime.ts`: lazy `getServerRuntime()` (Design §1)
- [x] Update the 9 call sites (Design §2) + `docs/CONVENTIONS.md` line
- [x] `apps/www/vite.config.ts`: add `nitro: { preset: 'cloudflare-pages' }` (Design §3)
- [x] `wrangler.toml`: update `pages_build_output_dir` (Design §4)
- [x] Resolve workflow consolidation per approval (Design §5) — deleted `deploy.yml`, updated
      `deploy-cloudflare.yml`'s paths; also fixed `package.json`'s `deploy:www` script (same stale
      `apps/www/dist` path, found while touching this area)
- [x] Local verification: `pnpm build:www` (config-based preset, no env var needed), then `wrangler
      pages dev apps/www/dist/analog/public`, curl `/api/status` twice (stable `records: 6`),
      `/api/v1/posts` (seeded post present), `/admin` (200 HTML), static asset (200)
- [x] Update STATE.md known issue #0 → removed; noted the deploy target in the `apps/www` row and
      Infrastructure section
- [x] Full gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## Test plan

- Manual (primary — this is infra, no unit-testable surface): build with `BUILD_PRESET=cloudflare-pages`,
  run `wrangler pages dev apps/www/dist/analog/public`, and check:
  1. `GET /api/status` twice in a row → same non-zero `records` count both times.
  2. `GET /api/v1/posts` → returns the seeded post (non-empty array).
  3. `GET /admin` → 200, HTML shell.
  4. A static asset (e.g. `/favicon.svg`) → 200.
- CI: push to a branch/PR, confirm `ci.yml` still green (lint/typecheck/test/build unaffected).
- After merge: `curl https://<production-url>/api/status` returns the JSON envelope with the same
  shape as local; `/admin` loads real collections in a browser.

## Acceptance criteria

1. `BUILD_PRESET=cloudflare-pages pnpm build:www` produces `apps/www/dist/analog/public/_worker.js/`.
2. `wrangler pages dev apps/www/dist/analog/public` serves a working `/api/status`,
   `/api/v1/posts` (non-empty, seeded), and `/admin` (200 HTML) — verified locally before merge.
3. Deployed site's `/api/status` returns the JSON envelope (verified after merge/deploy).
4. Deployed `/admin` loads real collections and documents in a browser.
5. Exactly one deploy workflow remains (or explicit sign-off to keep both, if that's the approval
   decision), and it is gated on tests passing before deploy.
6. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Open questions

None — workflow consolidation resolved (keep `deploy-cloudflare.yml`, delete `deploy.yml`).

## Outcome

Implemented as designed, with the workflow-consolidation open question resolved (keep
`deploy-cloudflare.yml`, delete `deploy.yml`) before implementation. Verified end-to-end against a
real `wrangler pages dev` (workerd) instance: `/api/status` stable at `records: 6` across repeated
requests, `/api/v1/posts`/`/api/v1/pages` return seeded documents, `/admin` and static assets 200.
Full quality gates green. No changeset needed (no `packages/*` changed — this was entirely
`apps/www` + root infra).
