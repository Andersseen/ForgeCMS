# strata-editorial: ForgeCMS + Strata consumer

An editorial desk built on **published** `@forge-cms/*` server packages and the Strata tuple, deliberately
**outside** the ForgeCMS pnpm workspace (Angular 22 / Vite 8 here, Angular 21 / Vite 7 there). Why, and what
it proves: [ADOPTION-REPORT.md](ADOPTION-REPORT.md) · spec [102](../../docs/specs/102-strata-rc-real-consumer-adoption.md).

> Strata is pinned to the published **RC0 baseline** (0.2.2 / 0.12.1 / 0.17.0) until `1.0.0-rc.0` is on npm.
> `pnpm verify:tuple` exits 2 and labels all evidence **rehearsal only** until then.

## Run

Node 22, pnpm 10.11.0, and `sqlite3` on `PATH` (for the local D1 seed).

```sh
cd consumers/strata-editorial
pnpm install --frozen-lockfile
pnpm verify:tuple        # 0 = published RC, 2 = pre-RC baseline, 1 = invalid tuple
pnpm typecheck && pnpm test

# Node production (durable libSQL)
pnpm build
pnpm qualify:leaks       # browser output confidentiality + positive control
pnpm qualify:node        # HTTP matrix, concurrency, failure/recovery, shutdown
pnpm e2e                 # Chromium on the built server
pnpm qualify:upgrade     # release A → B → retained A (builds both itself)

# Cloudflare Pages (local workerd + local D1; nothing remote)
pnpm build:cloudflare
pnpm e2e:workerd
pnpm qualify:workerd
```

Manual run: seed a fresh database, then start the built server.

```sh
DATABASE_URL=file:./data/editorial.db AUTH_SECRET=<32+ bytes> pnpm seed
DATABASE_URL=file:./data/editorial.db AUTH_SECRET=<same> PORT=4410 pnpm start
```

The seed uses the **synthetic** accounts in `scripts/fixture.ts`; never use them for a real deployment.
Production refuses to start without `DATABASE_URL` (Node) or a `DB` D1 binding (Pages); in-memory persistence exists
only under `pnpm dev`.

## Layout

| Path                                        | Role                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/app/cms/`                              | server-only: collections + access rules, runtime/profile, `EditorialService` |
| `src/server/strata/`, `src/server/plugins/` | Strata controller, CSRF guard, safe-error interceptor, registration          |
| `src/server/routes/api/`                    | native H3 routes (ForgeCMS login/logout/me, health)                          |
| `src/app/posts/`, `src/app/pages/`          | Server Component, islands, conventional and Server Component routes          |
| `qualification/`, `e2e/`, `tests/`          | evidence harnesses; JSON artifacts in `qualification/artifacts/`             |
