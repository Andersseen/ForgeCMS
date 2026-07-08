# 005 — D1 persistence in production

- **Status:** done
- **Author:** agent draft
- **Date:** 2026-07-07
- **Branch:** main
- **Affected packages/apps:** apps/www, root (`wrangler.toml`)

## Context / Why

PLAN.md P2-1 (depends on P1-1, done). Today the deployed demo uses `InMemoryDatabaseAdapter` even in
production — data lives per Workers isolate and disappears on cold start. This spec wires
`@forge-cms/cloudflare`'s existing, already-tested `D1DatabaseAdapter` in for real when a D1 binding
is present, falling back to in-memory in local dev (no behavior change there).

⚠️ **This spec requires creating a real D1 database in your Cloudflare account before it can be
completed** — a one-time `wrangler d1 create forge-cms` (or dashboard equivalent). That step provisions
actual cloud infrastructure tied to your account and needs your explicit go-ahead; it is not something
to run silently even though the local `wrangler` CLI in this environment already has `d1 (write)`
permission. Flagged as Open Question 1 — needs your answer before this spec can move past `draft`.

## Goal

The deployed demo's data persists across requests and cold starts via a real Cloudflare D1 database;
local dev is unaffected (still in-memory).

## Non-goals

- Migrations beyond `CREATE TABLE IF NOT EXISTS` (already what `syncSchema` does — no schema-versioning
  system).
- Switching `apps/www` to `LibSqlDatabaseAdapter` for local dev (stays in-memory; using a local SQLite
  file is a possible future nice-to-have, not required here).
- Any change to the `DatabaseAdapter` contract itself — `D1DatabaseAdapter` already implements it and
  passes the shared contract tests (`packages/cloudflare/src/d1.adapter.test.ts`).
- Auth (P2-2) — separate spec.

## Design

### 1. Runtime construction becomes lazy and env-aware

Today `apps/www/src/server/api/runtime.ts` constructs `ForgeCmsRuntime` (with a hardcoded
`InMemoryDatabaseAdapter`) and calls `runtime.init()` **eagerly at module scope**. To pick D1 vs.
in-memory based on the Cloudflare binding, construction must move inside the same lazy
`getServerRuntime()` entry point added in spec 002 (for the same reason: reading `env` only makes
sense once a request provides it, and — per spec 002's finding — no async I/O may run at module scope
on Workers anyway).

```ts
// apps/www/src/server/api/runtime.ts
export interface ServerEnv {
  DB?: D1Database; // present on Cloudflare Pages when the binding exists; absent locally
}

let runtimePromise: Promise<ForgeCmsRuntime> | undefined;

export function getServerRuntime(env?: ServerEnv): Promise<ForgeCmsRuntime> {
  if (!runtimePromise) {
    runtimePromise = buildRuntime(env);
  }
  return runtimePromise;
}

async function buildRuntime(env?: ServerEnv): Promise<ForgeCmsRuntime> {
  const database = env?.DB ? new D1DatabaseAdapter() : new InMemoryDatabaseAdapter();
  const runtime = new ForgeCmsRuntime({
    collections: [
      /* unchanged */
    ],
    adapters: { database, auth: new InMemoryAuthAdapter(), storage: new InMemoryStorageAdapter() },
    env
  });
  runtime.init();
  await runtime.syncSchema(); // no-op for in-memory; CREATE TABLE IF NOT EXISTS for D1
  await seedIfEmpty(runtime);
  return runtime;
}
```

The first call to `getServerRuntime(env)` in a given isolate wins and is cached — matches the existing
lazy-singleton shape from spec 002, just with the adapter decided at that point instead of hardcoded.

### 2. Every call site passes the Cloudflare env through

Nitro's `cloudflare-pages` runtime entry puts the platform env at `event.context.cloudflare.env`
(verified in spec 002's investigation of `nitropack`'s `cloudflare-pages.mjs` + `internal/app.mjs`,
which spread `_platform.cloudflare` directly onto `event.context`). Every route/middleware that calls
`getServerRuntime()` today (the same 9 files spec 002 touched) changes to:

```ts
const serverRuntime = await getServerRuntime(event.context.cloudflare?.env);
```

Locally (`pnpm dev:www`, plain Node/Vite), `event.context.cloudflare` is `undefined`, so `env` is
`undefined`, so `env?.DB` is falsy, so `InMemoryDatabaseAdapter` is selected — **identical to today's
local dev behavior, zero change there.**

### 3. Idempotent seeding (D1 persists — don't reseed on every cold start)

Today's `seedData()` unconditionally inserts demo rows every time the module runs. That's fine for
in-memory (fresh empty store every time) but would insert duplicate demo posts/pages/etc. into D1 on
every cold start, since D1 data survives between isolates. Guard it:

```ts
async function seedIfEmpty(runtime: ForgeCmsRuntime): Promise<void> {
  const existing = await runtime.adapters.database.findMany({
    collection: 'site_config',
    limit: 1
  });
  if (existing.length > 0) return; // already seeded (D1) — skip
  await seedData(runtime);
}
```

`site_config` is seeded with exactly one record and nothing else in the app creates one, so it's a
safe, cheap sentinel for "has this database already been seeded." (In-memory always starts empty, so
this guard is a no-op there — seeding still runs every cold start/reload as today.)

### 4. `wrangler.toml` binding

Once the D1 database exists (Open Question 1), add:

```toml
[[d1_databases]]
binding = "DB"
database_name = "forge-cms"
database_id = "<the real id from `wrangler d1 create`>"
```

### 5. `apps/www/package.json` dependency

Add `@forge-cms/cloudflare` (`workspace:*`) as a dependency — not currently a dependency of
`apps/www`, since it's never imported `D1DatabaseAdapter` before.

## Implementation plan

- [x] **Open Question 1 resolved** — created the D1 database (`wrangler d1 create forge-cms`),
      `database_id = 1b95312e-12c4-4d5e-b282-6d5067772754`
- [x] `apps/www/package.json`: add `@forge-cms/cloudflare` dependency
- [x] `apps/www/src/server/api/runtime.ts`: lazy env-aware construction (Design §1), idempotent seed
      guard (Design §3)
- [x] Update the 9 call sites to pass `event.context.cloudflare?.env` (Design §2)
- [x] `wrangler.toml`: add the `[[d1_databases]]` block (Design §4)
- [x] Local verification: `pnpm dev:www` still works identically (in-memory, unaffected) — confirmed
- [x] Verification against real D1: `wrangler pages dev` (config-implied output dir, D1 binding
      auto-attached from `wrangler.toml`) — confirmed `/api/status` shows `"name": "d1"`, restarted
      the dev server twice, confirmed data persisted with no duplicate seed rows, confirmed a created
      document survives a restart
- [x] **Found and fixed a real bug along the way**: `generateCreateTableSql` produced multi-line SQL,
      which failed with `SQLITE_ERROR: incomplete input` against a real D1 binding — Cloudflare D1's
      `exec()` splits its input on `\n` to detect multiple statements, a well-known quirk that mocked
      D1 tests never exercise. Fixed in `@forge-cms/db` to emit single-line SQL; added a regression
      test (`schema-generator.test.ts`, previously nonexistent) asserting the output has no newlines.
- [x] Update STATE.md (`apps/www` row, `@forge-cms/cloudflare`/`@forge-cms/db` rows: D1 wired in
      production; new known issue about the D1 exec() newline quirk)
- [x] Full gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## Test plan

- Manual only (infra-dependent, same reasoning as spec 002): `wrangler pages dev` against the real
  local D1 emulation — create a document, restart the dev server, confirm it's still there (D1
  persists; in-memory would have reset). Confirm re-running the seed doesn't duplicate rows on a
  second cold start.
- `pnpm dev:www` (plain Node) behaves exactly as before — regression check that the D1 change doesn't
  affect local dev.
- After deploy: `curl https://<production>/api/status` shows `"database": { "name": "d1" }`; create a
  document via the admin UI, wait for/force a cold start (or just revisit later), confirm the document
  is still there.

## Acceptance criteria

1. A real D1 database exists and is bound in `wrangler.toml`.
2. Deployed `/api/status` reports `database.name === 'd1'`.
3. A document created via the deployed admin UI survives a cold start (verified after deploy).
4. `pnpm dev:www` local behavior is unchanged (in-memory, resets on reload, as documented today).
5. Seeding does not duplicate rows across repeated cold starts against the same D1 database.
6. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Open questions

None — resolved (D1 database created with your approval).

## Outcome

Implemented as designed and verified against a real local D1 binding (`wrangler pages dev`, not just
mocks): `/api/status` reports `database.name === 'd1'`, seeding is idempotent across repeated cold
starts, and a created document survives a full dev-server restart. Along the way, found and fixed a
real, previously-invisible bug in `@forge-cms/db`'s `generateCreateTableSql` (multi-line SQL breaks
Cloudflare D1's real `exec()`, which naively splits on `\n`) — added a regression test since no test
exercised this function against real SQL execution before. `pnpm dev:www` (local, in-memory) is
unaffected. Full quality gates green. Two changesets: `@forge-cms/db` (the exec() fix) has no
directly-related package changes beyond it; `apps/www`/root changes don't need one (not a package).

**Not yet deployed to production** — `wrangler.toml` now has the real `database_id`, but this hasn't
been pushed through the deploy workflow yet; that happens on the next merge to `main`.
