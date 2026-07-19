# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `@forge-cms/core`: Schema DSL with strong TypeScript types and runtime validation.
- `@forge-cms/db`: DatabaseAdapter contract with in-memory and LibSQL (drizzle) adapters.
- `@forge-cms/auth`: AuthAdapter contract with in-memory, external, and signed-token adapters.
- `@forge-cms/storage`: StorageAdapter contract with in-memory adapter.
- `@forge-cms/api`: ApiContext / CRUD handler types.
- `@forge-cms/runtime`: ForgeCmsRuntime orchestrator + framework-agnostic HTTP CRUD handlers.
- `@forge-cms/cloudflare`: Cloudflare D1 database adapter and R2 storage adapter.
- `@forge-cms/angular`: Angular client SDK (`CmsApiService`, `provideForgeCms`).
- `@forge-cms/admin`: Angular admin UI components (layout, document list, schema-driven form).
- `@forge-cms/testing`: Shared adapter contract test suites.
- `apps/www`: Analog.js landing page + `/admin` demo + h3 server API (`/api/v1/*`).
- `apps/playground`: Analog.js sandbox for trying CMS APIs.
- CI/CD pipeline with GitHub Actions (lint, typecheck, test, E2E, Cloudflare Pages deploy).

### Infrastructure

- pnpm workspaces + Turborepo.
- ESLint with TypeScript, import, and unicorn plugins.
- Prettier for code formatting.
- Changesets for version management and publishing.
- Cloudflare Pages deployment via Wrangler.

### Notes

- Package versions are being normalized to `0.1.0` before the first npm publish.
- See the per-package changelogs (e.g. `packages/angular/CHANGELOG.md`) for detailed changes.
