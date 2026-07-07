# ForgeCMS

[![CI](https://github.com/forge-cms/forge-cms/actions/workflows/ci.yml/badge.svg)](https://github.com/forge-cms/forge-cms/actions/workflows/ci.yml)
[![E2E](https://github.com/forge-cms/forge-cms/actions/workflows/e2e.yml/badge.svg)](https://github.com/forge-cms/forge-cms/actions/workflows/e2e.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A code-first, TypeScript-native headless CMS foundation for Angular and Analog.js — "Payload for
Angular." Edge-first: designed to run on Cloudflare Pages/Workers with D1 + R2.

## Status

**Experimental, pre-alpha, not production-ready** — but substantially implemented, not just
scaffolding. Working today: the schema DSL and runtime validation, a framework-agnostic CRUD
runtime with HTTP handlers, database adapters (in-memory, LibSQL, Cloudflare D1), storage adapters
(in-memory, Cloudflare R2), an Angular client SDK, and a demo admin UI served by the real runtime in
`apps/www`. Still missing: a real auth provider, the `@forge-cms/admin` Angular package isn't yet
consumed by the demo, and nothing is published to npm. See [docs/STATE.md](docs/STATE.md) for the
full, continuously-updated picture and [docs/PLAN.md](docs/PLAN.md) for what's being worked on next.

## Quick Start

```sh
# Install dependencies
pnpm install

# Start the landing app + /admin demo (real API, in-memory adapters, seed data)
pnpm dev:www

# Start the playground
pnpm dev:playground
```

## Commands

```sh
pnpm dev              # Start all apps in dev mode
pnpm dev:www          # Start landing app + /admin demo
pnpm dev:playground   # Start playground only
pnpm build            # Build all packages and apps
pnpm deploy:www       # Build and deploy the www app
pnpm test             # Run all tests
pnpm test:watch       # Run tests in watch mode
pnpm e2e:www          # Run E2E tests (Playwright)
pnpm lint             # Lint all packages
pnpm typecheck        # Type-check all packages
pnpm format           # Format code with Prettier
pnpm format:check     # Check formatting
pnpm changeset        # Add a changeset (required for packages/* changes)
pnpm clean            # Clean build artifacts
```

## Monorepo Structure

```txt
apps/
  www/          Analog.js landing page + /admin demo UI + h3 server API (/api/v1/*)
  playground/   Analog.js sandbox for trying CMS APIs

packages/
  core/         Schema DSL (defineCollection / defineField) + runtime validation
  db/           DatabaseAdapter contract + in-memory and LibSQL (drizzle) adapters
  auth/         AuthAdapter contract + in-memory and external(token) adapters
  storage/      StorageAdapter contract + in-memory adapter
  api/          ApiContext / CRUD handler types
  runtime/      ForgeCmsRuntime orchestrator + framework-agnostic HTTP CRUD handlers
  cloudflare/   Cloudflare D1 (database) and R2 (storage) adapters
  angular/      Angular client SDK (CmsApiService, provideForgeCms)
  admin/        Angular admin components (skeleton — not yet consumed by apps/www)
  testing/      Shared adapter contract test suites
```

## Packages

| Package              | Version | Description                                              |
| -------------------- | ------- | --------------------------------------------------------- |
| `@forge-cms/core`      | 0.0.0   | Schema DSL with types + runtime validation                |
| `@forge-cms/db`        | 0.0.0   | DatabaseAdapter contract + in-memory/LibSQL adapters       |
| `@forge-cms/auth`      | 0.0.0   | AuthAdapter contract + in-memory/external adapters         |
| `@forge-cms/storage`   | 0.0.0   | StorageAdapter contract + in-memory adapter                |
| `@forge-cms/api`       | 0.0.0   | CRUD/API context and handler types                         |
| `@forge-cms/runtime`   | 0.0.0   | Runtime orchestrator + framework-agnostic CRUD HTTP handlers |
| `@forge-cms/cloudflare`| 0.0.0   | Cloudflare D1 + R2 adapters                                |
| `@forge-cms/angular`   | 0.0.0   | Angular client SDK                                          |
| `@forge-cms/admin`     | 0.0.0   | Angular admin UI components (skeleton, not yet wired up)    |
| `@forge-cms/testing`   | 0.0.0   | Shared adapter contract test suites                        |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, workflow, and guidelines.

## Code of Conduct

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE)

## Cloudflare Pages

`apps/www` builds to `apps/www/dist` and is configured for Cloudflare Pages with Wrangler.
⚠️ The current production deploy is client-only static files (no `/api/*`) — see
[docs/PLAN.md](docs/PLAN.md) task P1-1 for the fix in progress.

Required GitHub secrets for deployment:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
