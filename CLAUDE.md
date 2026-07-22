# CLAUDE.md — Agent Guide for ForgeCMS

ForgeCMS is an experimental, TypeScript-native, Payload-like headless CMS for **Angular / Analog.js**, designed to run on the edge (Cloudflare Pages, D1, R2). Monorepo: **pnpm workspaces + Turborepo**, ESM-only, TypeScript strict.

## Read this first (in order)

1. This file — commands, hard rules, gotchas.
2. [docs/STATE.md](docs/STATE.md) — what is implemented **today** and what's next. Trust STATE.md and the code over any other doc if they disagree.
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — package graph, data flow, API contracts.
4. [docs/CONVENTIONS.md](docs/CONVENTIONS.md) — code style and patterns you MUST follow.
5. [docs/SDD.md](docs/SDD.md) — spec-driven workflow. Non-trivial features need a spec in `docs/specs/` before coding; past specs there are also the historical record of why things are built the way they are.

## Environment & commands

Node >= 22 (`.nvmrc`), pnpm `10.11.0` (via `packageManager` field). Never use npm or yarn.

| Command                                | Purpose                                                   |
| -------------------------------------- | --------------------------------------------------------- |
| `pnpm install`                         | Install deps (frozen lockfile in CI)                      |
| `pnpm build`                           | Build all packages/apps (topological, cached by Turbo)    |
| `pnpm dev:www` / `pnpm dev:playground` | Run the landing/admin app or the playground               |
| `pnpm test`                            | Unit tests (Vitest) across the repo                       |
| `pnpm lint` / `pnpm typecheck`         | ESLint / `tsc --noEmit` across the repo                   |
| `pnpm format` / `pnpm format:check`    | Prettier write / check                                    |
| `pnpm e2e:www`                         | Playwright e2e for `apps/www`                             |
| `pnpm changeset`                       | Add a changeset (required when changing any `packages/*`) |

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

- **Business logic lives in the Local API**, not the HTTP layer: `packages/runtime/src/operations.ts` (`find`/`findByID`/`create`/`update`/`delete`/`count`), exposed as methods on `ForgeCmsRuntime`. It runs the whole pipeline — access, hooks, drafts, relation population, validation — with no HTTP involved. **This is the intended way to use ForgeCMS from server code** (an Analog server route, a seed script), and new operation logic belongs here.
- `packages/runtime/src/handlers.ts` is transport only: query parsing, multipart, the auth gate, the JSON envelope, and mapping typed errors (`errors.ts`) to status codes. Don't put logic there.
- `overrideAccess` defaults to **`true`** on Local API calls (trusted server code); the HTTP layer always passes `false` plus the resolved user. If you add an operation, keep that split.
- HTTP API routes live in `apps/www/src/server/routes/api/` (Analog/Nitro h3 file routes) and delegate to the `handleX` handlers — keep routes thin.
- The server runtime instance + demo collections + seed data: `apps/www/src/server/api/runtime.ts` (in-memory adapters locally, D1 when `env.DB` exists; local data resets on every reload — that's expected).
- The `/admin` UI in `apps/www` consumes `@forge-cms/admin`'s real components; `dashboard`/`media`/`users`/`api`/`settings` pages remain app-local.
- Roadmap and sequencing: [docs/ROADMAP.md](docs/ROADMAP.md). Phase 1 (Local API, function-based access, full hooks, composite fields) is done; Phases 2–5 are not started.
