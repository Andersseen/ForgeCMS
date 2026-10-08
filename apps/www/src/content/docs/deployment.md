---
title: Deployment
description: The two durable production profiles — Cloudflare (D1 + R2) and portable Node (libSQL + S3) — from setup to recovery.
group: Client & deploy
order: 4
---

ForgeCMS has **two official durable production profiles**. Each is complete — database, file storage, auth,
admin, server-rendered public pages, uploads — and each is exercised in CI from packed public packages
through a production build, a browser journey, a restart and a backup/restore.

| Profile        | Database                | Files                           | Runtime                           | CI evidence                                                   |
| -------------- | ----------------------- | ------------------------------- | --------------------------------- | ------------------------------------------------------------- |
| **Cloudflare** | D1 (`DB` binding)       | R2 (`BUCKET` binding)           | Cloudflare Pages / Workers        | **Local** workerd + local D1 + local R2 (not a remote deploy) |
| **Portable**   | libSQL (`DATABASE_URL`) | S3-compatible (`@forge-cms/s3`) | Node (`node-server` Nitro preset) | On-disk libSQL + real Garage `v2.4.1` S3 service              |

> **Production never silently falls back to memory.** `InMemoryDatabaseAdapter` and `InMemoryStorageAdapter` are
> development and test adapters: they prove nothing about durability. A deployment must be built from exactly
> one complete profile, and a production build with a missing binding or variable should **refuse to start**
> and name what is missing, instead of serving a site that forgets everything. ForgeCMS itself accepts any
> adapter combination; this is the policy of your app's server factory (the `apps/tiny-project` fixture's
> [`profile.ts`](https://github.com/Andersseen/ForgeCMS/blob/main/apps/tiny-project/src/server/api/profile.ts) is the tested reference).

**Certified S3-compatible service:** Garage `v2.4.1` (pinned image digest) in CI. AWS S3, Backblaze B2 and
Wasabi are _configurable_ through the same options but **not** CI-certified. Remote Cloudflare deployments are
not certified by the CI gate either — only local workerd, D1 and R2 are.

## Profile A — Cloudflare (D1 + R2)

The compiled API server runs on Pages; the adapters ship in `@forge-cms/cloudflare`.

```sh
pnpm add @forge-cms/core @forge-cms/runtime @forge-cms/auth @forge-cms/db @forge-cms/storage \
  @forge-cms/api @forge-cms/cloudflare @forge-cms/angular @forge-cms/admin
```

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

> `binding` is the name in code, not the resource name. The profile factory below requires `env.DB` **and**
> `env.BUCKET`; rename either and a correctly written factory refuses to start (a naive
> `env.DB ? D1 : InMemory` selector would instead deploy something that looks fine and forgets everything).
> Either keep the names, or pass `new D1DatabaseAdapter({ binding: 'CONTENT_DB' })` /
> `new R2StorageAdapter({ binding: 'MEDIA' })`.

Secrets and environment variables use the same file for non-secret values (`[vars]`, for example
`FORGE_SSR_ORIGIN`, see [SSR](/docs/ssr)); secrets are set with `wrangler pages secret put` (§6). The Pages
configuration page requires `name`, `pages_build_output_dir` and an explicit `compatibility_date`.

`compatibility_date` must not be newer than the runtime your pinned wrangler ships, or it refuses to
start.

## 4. The durable profile factory

```ts
// src/server/api/runtime.ts
export async function getServerRuntime(env: ServerEnv) {
  // Throws — naming the missing binding — unless BOTH DB and BUCKET exist.
  if (!env.DB || !env.BUCKET) {
    throw new Error(
      `Incomplete Cloudflare profile: missing ${[!env.DB && 'DB', !env.BUCKET && 'BUCKET'].filter(Boolean).join(', ')}`
    );
  }
  const database = new D1DatabaseAdapter();
  const storage = new R2StorageAdapter(); // private bucket; files are served by handleFile (§ below)
  const auth = new UsersCollectionAuthAdapter().init({ ...env, userDatabase: database });

  const runtime = new ForgeCmsRuntime({ collections, adapters: { database, auth, storage }, env });
  runtime.init();
  await runtime.syncSchema();
  return runtime;
}
```

Keep a separate **development factory** (`import.meta.dev === true`) if you want in-memory adapters locally —
but never reachable from a production build. `apps/tiny-project` does exactly this: development may be
in-memory, production needs a complete profile, and a mixed Cloudflare + portable configuration is rejected as
ambiguous.

The rest of the app is the [small-project guide](/docs/small-project-guide): auth routes, `/api/v1/[collection]`
CRUD routes, the reusable admin, and the file route:

```ts
// src/server/routes/api/media/[...key].get.ts
export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  return handleFile(
    {
      request: toWebRequest(event),
      params: { key: routeParam(event, 'key') },
      env: event.context.cloudflare?.env
    },
    { runtime }
  );
});
```

`R2StorageAdapter` reports `/api/media/<key>` as the public URL, so uploads (`POST /api/v1/media`, multipart)
are served through `handleFile`, which checks the owning document's read access (draft visibility, row-level
rules) on every request. Keep the bucket **private**. For server-rendered public pages see
[SSR](/docs/ssr) (`provideForgeCmsServer`, a `credentials: 'omit'` public client, hydration transfer).

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

Create the first admin (`POST /api/bootstrap-admin` in the small-project guide), upload one file, restart or
redeploy, and fetch the file's `/api/media/…` URL again. A correctly written profile factory already refuses
to start when a binding is missing; this check proves that data and files really persist.

## Local development against real bindings

```sh
pnpm build
pnpm exec wrangler pages dev dist/analog/public --d1 DB --r2 BUCKET --persist-to .wrangler/state
```

(`--d1`/`--r2` are the documented local-binding flags; bindings declared in `wrangler.toml` are used too, and the
command line wins if both exist. Wrangler persists local D1 and R2 data by default.) A production build needs
`AUTH_SECRET` here as well: put it in a git-ignored `.dev.vars` next to `wrangler.toml`. This runs the actual
production build with local emulations of D1 and R2 — worth doing before shipping, because the Vite dev server
uses in-memory adapters and cannot reproduce SQL-level or storage bugs.

## Profile B — Portable Node (libSQL + S3)

No Cloudflare account, no binding of any kind. Same collections, auth, admin, SSR and upload pipeline.

```sh
pnpm add @forge-cms/core @forge-cms/runtime @forge-cms/auth @forge-cms/db @forge-cms/storage \
  @forge-cms/s3 @forge-cms/api @forge-cms/angular @forge-cms/admin @libsql/client
```

```ts
// vite.config.ts — Nitro's tracer cannot follow libSQL's per-platform native package, so keep dependencies in node_modules
analog({
  ssr: true,
  prerender: { routes: [] },
  nitro: { preset: 'node-server', externals: { trace: false } }
});
```

```ts
// src/server/api/runtime.ts
const url = process.env['DATABASE_URL'];
const bucket = process.env['S3_BUCKET'];
const region = process.env['S3_REGION'];
if (!url || !bucket || !region) {
  throw new Error(
    'Incomplete portable profile: DATABASE_URL, S3_BUCKET and S3_REGION are all required'
  );
}
const database = new LibSqlDatabaseAdapter(url);
const storage = new S3StorageAdapter({
  bucket,
  region,
  ...(process.env['S3_ENDPOINT'] && { endpoint: process.env['S3_ENDPOINT'] }),
  ...(process.env['S3_FORCE_PATH_STYLE'] === 'true' && { forcePathStyle: true }),
  // Omit `credentials` to use the AWS SDK default provider chain (IAM role, env, profile…).
  ...(process.env['S3_ACCESS_KEY_ID'] && {
    credentials: {
      accessKeyId: process.env['S3_ACCESS_KEY_ID'],
      secretAccessKey: process.env['S3_SECRET_ACCESS_KEY']!
    }
  })
});
```

Everything else — `handleFile` at `/api/media/[...key]`, auth/CRUD routes, the admin, `provideForgeCmsServer` — is
identical to Profile A. Environment for the built server:

| Variable                                   | Purpose                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `AUTH_SECRET`                              | ≥ 32 bytes (`openssl rand -base64 48`); the build refuses to start without it |
| `DATABASE_URL`                             | `file:/data/forge.db` or a `libsql://` URL                                    |
| `S3_BUCKET`, `S3_REGION`                   | The bucket must **already exist** (Forge never creates buckets)               |
| `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE=true`  | For S3-compatible services such as Garage, B2 or Wasabi                       |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Static credentials (a pair), or omit both for the AWS provider chain          |
| `FORGE_SSR_ORIGIN`                         | The origin the server render uses to reach its own `/api/*` routes            |

Build and run (the built server references `node_modules`, so install production dependencies beside `dist/`):

```sh
pnpm build
pnpm install --prod
AUTH_SECRET=… DATABASE_URL=file:/data/forge.db S3_BUCKET=… S3_REGION=… FORGE_SSR_ORIGIN=https://example.com \
  node dist/analog/server/index.mjs
```

> **An on-disk libSQL file inside an ephemeral container or serverless filesystem is not durable.** With
> `DATABASE_URL=file:/data/forge.db`, `/data` must be a persistent volume (or equivalent) that survives restarts and
> redeploys. Uploaded files are separately durable in object storage. If you cannot guarantee a persistent
> filesystem, use a remote `libsql://` database instead. Run **one** server process per database file.

S3 settings are server-side only: they never reach a browser bundle (the CI journey scans the browser output for
`S3StorageAdapter`, `@aws-sdk`, the keys and the secret). Provider notes: [Uploads](/docs/uploads) and the
`@forge-cms/s3` README.

### Public URLs and access

Both profiles default to `/api/media/<key>` served by `handleFile`. Setting `publicUrlBase` to a direct bucket
or CDN URL **bypasses ForgeCMS access control** entirely — anyone with the URL reads the object. Use it only for
media that is public by design; never for private or draft-gated files, and never configure a public bucket
policy for them.

## Backup, upgrade and recovery

Back up **before** any schema migration, with writes quiesced. The database snapshot is the source of truth for
which objects are required; there is no atomic snapshot across a database and an object store. The tested
sequence for both profiles — including restoring into an isolated, empty database and bucket — is in the
[backup and restore runbook](https://github.com/Andersseen/ForgeCMS/blob/main/docs/BACKUP-RESTORE.md). Schema
changes: [Schema upgrades](/docs/schema-upgrades).

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

Server-rendered public pages, the admin, a multipart upload, `handleFile` serving, a restart and a delete are
certified on both complete profiles: a built Cloudflare Pages output under local workerd + local D1 + local R2,
and a built `node-server` with an on-disk libSQL database + Garage. Remote Cloudflare/AWS deployments are not
certified by that gate. See [SSR](/docs/ssr#deployment-notes-two-proven-production-profiles).

## Other platforms

Nothing outside `@forge-cms/cloudflare` is Cloudflare-specific. Other presets (Vercel, Netlify, Deno) work in
principle if you pair `LibSqlDatabaseAdapter` (SQLite or Turso) with `@forge-cms/s3` or a storage adapter of
your own; the contract test suites tell you when your adapter is done. Only the profiles above are certified.
