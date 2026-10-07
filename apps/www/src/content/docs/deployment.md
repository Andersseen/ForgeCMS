---
title: Deployment
description: Shipping an Analog + ForgeCMS app to Cloudflare Pages with D1 and R2.
group: Client & deploy
order: 4
---

ForgeCMS is built for the edge: the runtime is Web-standard (`Request`, `Response`, `crypto`) and the
adapters for Cloudflare's storage primitives ship in `@forge-cms/cloudflare`.

## 1. Build for Pages

```ts
// vite.config.ts
export default defineConfig({
  plugins: [analog({ ssr: false, nitro: { preset: 'cloudflare-pages' } })]
});
```

The `cloudflare-pages` preset emits `dist/analog/public` including `_worker.js` — the compiled API
server. Static assets and `/api/*` are served by the same Worker.

## 2. Create the resources

```sh
pnpm exec wrangler d1 create my-app
pnpm exec wrangler r2 bucket create my-app-media
```

## 3. Bind them

```toml
# wrangler.toml
name = "my-app"
compatibility_date = "2026-05-15"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "dist/analog/public"

[[d1_databases]]
binding = "DB"            # the name your code looks for
database_name = "my-app"
database_id = "…"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "my-app-media"
```

> `binding` is the name in code, not the resource name. `getServerRuntime` checks `env.DB` and
> `env.BUCKET`; rename either and the app silently falls back to in-memory adapters — a deploy that
> looks fine and forgets everything. Either keep the names, or pass
> `new D1DatabaseAdapter({ binding: 'CONTENT_DB' })`.

`compatibility_date` must not be newer than the runtime your pinned wrangler ships, or it refuses to
start.

## 4. Pick adapters from the env

```ts
// src/server/api/runtime.ts
export async function getServerRuntime(env?: ServerEnv) {
  const database = env?.DB ? new D1DatabaseAdapter() : new InMemoryDatabaseAdapter();
  const storage = env?.BUCKET ? new R2StorageAdapter() : new InMemoryStorageAdapter();
  const auth = new UsersCollectionAuthAdapter().init({ ...env, userDatabase: database });

  const runtime = new ForgeCmsRuntime({ collections, adapters: { database, auth, storage }, env });
  runtime.init();
  await runtime.syncSchema();
  await seedOnce(runtime); // idempotent: check for a row before inserting
  return runtime;
}
```

Two rules that are not optional on Workers:

1. **Build the runtime lazily, on the first request** — not at module scope. Async I/O at module load
   is forbidden, and bindings are not available there anyway.
2. **Make seeding idempotent.** Workers cold-start repeatedly; a seed that does not check first
   duplicates rows on every cold start.

On a fresh D1 database no migration step is needed: `syncSchema()` creates every table on the first
request. On a database that already has rows, it applies only safe additive changes and (since `0.8.0`)
refuses drift that needs a data migration. The runtime then fails to start instead of serving a
half-matching schema. Check a deployed database with `runtime.planSchema()` before you deploy a schema
change. A blocking change is applied with `runtime.runMigrations()` from a deploy script (never at
Worker startup), after a backup. See [Schema upgrades](/docs/schema-upgrades).

## 5. Deploy

```sh
pnpm exec wrangler pages deploy dist/analog/public --project-name=my-app
```

In a monorepo, `pages deploy` has **no `--config` flag** — use `--cwd` to select a second project's
`wrangler.toml`:

```sh
wrangler pages deploy --cwd apps/demo-aesthetics --project-name=forge-cms-demo
```

This repo does both from CI (`.github/workflows/ci.yml`): one `checks` job (format, lint, typecheck,
test, build, Playwright e2e), then a `deploy` job gated on `push` to `main`, so PRs and forks never
deploy. It needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.

## 6. Set secrets

```sh
pnpm exec wrangler pages secret put AUTH_SECRET --project-name=my-app
```

`AUTH_SECRET` signs auth tokens. It must be at least 32 bytes (`openssl rand -base64 48`), and a build
without it refuses to start rather than falling back to Forge's public development secret — dev mode is
only ever an explicit `devMode: true` (see [Browser auth](/docs/browser-auth#production-configuration-and-abuse-limits)).
Set it before you have real users — rotating it invalidates every issued token.

Login and signup throttling belongs to the platform: a WAF rate limiting rule on `/api/auth/login` and
`/api/auth/signup` for a Pages project, or a Workers Rate Limiting binding passed to `handleLogin`'s
`throttle` option for a Worker.

## 7. Verify the deploy

```sh
curl https://my-app.pages.dev/api/status
```

Check that the adapter name is `d1` and not `in-memory`. That one call catches the most common
failure mode: a missing or misnamed binding, where everything works and nothing persists.

## Local development against real bindings

```sh
pnpm build
pnpm exec wrangler pages dev apps/www/dist/analog/public --d1 DB --r2 BUCKET
```

A production build needs `AUTH_SECRET` here too: put it in a git-ignored `.dev.vars` next to
`wrangler.toml`. That runs the actual production build with local emulations of D1 and R2 — worth doing before
shipping, because the Vite dev server uses in-memory adapters and cannot reproduce SQL-level bugs.

## What's actually verified against real Cloudflare bindings

`@forge-cms/cloudflare`'s adapters ship with two layers of tests: a fast unit suite (`pnpm
--filter @forge-cms/cloudflare test`) against a hand-written D1/R2 mock, and a slower integration
suite (`pnpm test:cloudflare`, `@cloudflare/vitest-plugin`) that runs the same adapters — schema
sync, compound unique indexes, nested `and`/`or` queries, `containsValue`, JSON round-tripping,
machine auth, one full HTTP request/response path, and R2 — against a **real local D1 and R2
binding** (Miniflare/workerd), with no Cloudflare account, credentials, or remote resources
required. That's what "locally verified against real Workers bindings" means throughout this repo's
docs: proven against the real engine running on your machine or in CI, not a simulation of it. It is
**not** the same claim as a verified remote production deployment — that's still only checked by the
`curl`-and-inspect step above, run by a maintainer after a real deploy.

## Server-rendered production (SSR)

Server-rendered public pages are certified on a built Cloudflare Pages output under local workerd + local D1,
and on a built `node-server` with an on-disk libSQL database (including a restart). Remote Cloudflare
deployments are not certified by that gate. See [SSR](/docs/ssr#deployment-notes-two-proven-production-profiles).

## Other platforms

Nothing outside `@forge-cms/cloudflare` is Cloudflare-specific. The Node preset with `LibSqlDatabaseAdapter` is
proven for SSR (needs `nitro: { externals: { trace: false } }` and `node_modules` beside `dist/`; see
[SSR](/docs/ssr#node--libsql)). Other presets (Vercel, Netlify, Deno) work in principle if you pair them with
`LibSqlDatabaseAdapter` (SQLite or Turso) and a storage adapter of your own; the contract test suites tell you when your adapter is done.
