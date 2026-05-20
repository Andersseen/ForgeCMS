# ForgeCMS

[![CI](https://github.com/forge-cms/forge-cms/actions/workflows/ci.yml/badge.svg)](https://github.com/forge-cms/forge-cms/actions/workflows/ci.yml)
[![E2E](https://github.com/forge-cms/forge-cms/actions/workflows/e2e.yml/badge.svg)](https://github.com/forge-cms/forge-cms/actions/workflows/e2e.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

An experimental Payload-like CMS foundation for Angular and Analog.js developers.

## Goal

ForgeCMS aims to become a developer-first, TypeScript-native CMS that feels natural in Angular and Analog.js projects. This repository is the monorepo foundation: package boundaries, contracts, testing, and a schema DSL prototype.

## Status

Experimental and not production-ready. The CMS runtime, database adapters, auth adapters, storage adapters, CRUD handlers, and admin UI are intentionally not implemented yet.

## Quick Start

```sh
# Install dependencies
pnpm install

# Start the landing app
pnpm dev:www

# Start the playground
pnpm dev:playground
```

## Commands

```sh
pnpm dev              # Start all apps in dev mode
pnpm dev:www          # Start landing app only
pnpm dev:playground   # Start playground only
pnpm build            # Build all packages and apps
pnpm deploy:www       # Build and deploy landing app
pnpm test             # Run all tests
pnpm test:watch       # Run tests in watch mode
pnpm e2e:www          # Run E2E tests (Playwright)
pnpm lint             # Lint all packages
pnpm typecheck        # Type-check all packages
pnpm format           # Format code with Prettier
pnpm format:check     # Check formatting
pnpm clean            # Clean build artifacts
```

## Monorepo Structure

```txt
apps/
  www/          Official Analog.js landing app for ForgeCMS
  playground/   Analog.js playground for trying future CMS APIs

packages/
  core/         Base schema DSL and public core types
  db/           DatabaseAdapter contract
  auth/         AuthAdapter contract
  storage/      StorageAdapter contract
  api/          Future CRUD/API handler helpers
  admin/        Placeholder for the future Angular admin package
  testing/      Shared test helpers
```

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| `@forge-cms/core` | 0.0.0 | Schema DSL with types + runtime validation |
| `@forge-cms/db` | 0.0.0 | DatabaseAdapter contract |
| `@forge-cms/auth` | 0.0.0 | AuthAdapter contract |
| `@forge-cms/storage` | 0.0.0 | StorageAdapter contract |
| `@forge-cms/api` | 0.0.0 | CRUD/API helpers |
| `@forge-cms/admin` | 0.0.0 | Angular admin placeholder |
| `@forge-cms/testing` | 0.0.0 | Shared test utilities |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, workflow, and guidelines.

## Code of Conduct

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE)

## Cloudflare Pages

The official landing app builds to `apps/www/dist` and is configured for Cloudflare Pages with Wrangler.

Required GitHub secrets for deployment:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
