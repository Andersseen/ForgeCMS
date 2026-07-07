# CLAUDE.md — Agent Guide for ForgeCMS

ForgeCMS is an experimental, TypeScript-native, Payload-like headless CMS for **Angular / Analog.js**, designed to run on the edge (Cloudflare Pages, D1, R2). Monorepo: **pnpm workspaces + Turborepo**, ESM-only, TypeScript strict.

## Read this first (in order)

1. This file — commands, hard rules, gotchas.
2. [docs/STATE.md](docs/STATE.md) — what is implemented **today**. ⚠️ The README's "Status" section is outdated (it claims nothing is implemented — much is). Trust STATE.md and the code, not the README.
3. [docs/PLAN.md](docs/PLAN.md) — prioritized task list (QW-*/P1-*/P2-* IDs). If you were handed a task ID, it lives here.
4. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — package graph, data flow, API contracts.
5. [docs/CONVENTIONS.md](docs/CONVENTIONS.md) — code style and patterns you MUST follow.
6. [docs/SDD.md](docs/SDD.md) — spec-driven workflow. Non-trivial features need a spec in `docs/specs/` before coding.

## Environment & commands

Node >= 22 (`.nvmrc`), pnpm `10.11.0` (via `packageManager` field). Never use npm or yarn.

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install deps (frozen lockfile in CI) |
| `pnpm build` | Build all packages/apps (topological, cached by Turbo) |
| `pnpm dev:www` / `pnpm dev:playground` | Run the landing/admin app or the playground |
| `pnpm test` | Unit tests (Vitest) across the repo |
| `pnpm lint` / `pnpm typecheck` | ESLint / `tsc --noEmit` across the repo |
| `pnpm format` / `pnpm format:check` | Prettier write / check |
| `pnpm e2e:www` | Playwright e2e for `apps/www` |
| `pnpm changeset` | Add a changeset (required when changing any `packages/*`) |

**Quality gates — run before declaring any task done:**
`pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## Repo map

```
apps/
  www/          Analog.js landing + /admin demo UI + h3 server API (/api/v1/*) — deploys to Cloudflare Pages
  playground/   Analog.js sandbox for trying CMS APIs
packages/
  core/         Schema DSL (defineCollection / defineField) + runtime validation
  db/           DatabaseAdapter contract + InMemory + LibSQL(drizzle) adapters + SQL schema generator
  auth/         AuthAdapter contract + InMemory + External(token) adapters
  storage/      StorageAdapter contract + InMemory adapter
  api/          ApiContext / CRUD handler types
  runtime/      ForgeCmsRuntime orchestrator + framework-agnostic HTTP CRUD handlers
  cloudflare/   D1 + R2 adapters (KV planned, not implemented)
  angular/      Angular client SDK (CmsApiService, provideForgeCms)
  admin/        Angular admin components (skeleton, NOT yet used by apps/www)
  testing/      Adapter contract test suites (import from @forge-cms/testing/contracts)
```

## Hard rules

- **ESM only.** Every package has `"type": "module"`. Relative imports inside `packages/*` use the `.js` extension (`./validation.js`), even in `.ts` files.
- **Build order matters.** `tsconfig.base.json` maps `@forge-cms/*` to `packages/*/dist/index.d.ts`. On a fresh clone, `pnpm typecheck` fails until `pnpm build` has run. Turbo handles ordering; don't bypass it.
- **Strict TS gotchas:** `exactOptionalPropertyTypes` is on — use conditional spreads (`...(limit !== undefined && { limit })`) instead of passing `undefined`. `noUncheckedIndexedAccess` is on — indexed access returns `T | undefined`, guard it.
- **Lint-enforced:** `import type` for type-only imports, no floating promises (`await` or `void`), no import cycles, `node:` protocol for Node builtins.
- **New adapters MUST pass the contract tests** from `@forge-cms/testing/contracts` (`runDatabaseAdapterContractTests`, etc.).
- **Don't break the API envelope:** list → `{ data, meta }`, item → `{ data }`, error → `{ error, details? }`, delete → `204`. Clients (`@forge-cms/angular`, admin UI) depend on it.
- **Changeset required** for any change under `packages/*` (`pnpm changeset`). Apps don't need one.
- Import packages only through their entry points (`@forge-cms/db`), never deep paths into `src/` (exception: `@forge-cms/testing/contracts`, which is an official export).
- `@voltui/components` is the author's own UI library (source in sibling repo `../volt-ui`). Use it for UI in `apps/www` instead of hand-rolling components.
- After completing meaningful work, update `docs/STATE.md` (see its header for how).

## Where things happen

- HTTP API lives in `apps/www/src/server/routes/api/` (Analog/Nitro h3 file routes) and delegates to `@forge-cms/runtime` handlers — keep routes thin.
- The server runtime instance + demo collections + seed data: `apps/www/src/server/api/runtime.ts` (in-memory adapters; data resets on every reload — that's expected).
- The `/admin` UI in `apps/www` is a demo built with local components; migrating it to `@forge-cms/admin` is a known pending task.
