# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - 2026-08-25

First public experimental release of ForgeCMS.

API stability is not guaranteed before `1.0`.

### Added

- `@forge-cms/core`: Schema DSL with TypeScript types, runtime validation, access/hook metadata,
  relations, uploads, rich text, composite fields, globals, versions, localization metadata, and
  relation integrity options.
- `@forge-cms/db`: DatabaseAdapter contract with in-memory and LibSQL adapters plus additive
  SQLite-style schema synchronization helpers.
- `@forge-cms/auth`: AuthAdapter contract with in-memory, external, signed-token, and users-collection
  adapters.
- `@forge-cms/storage`: StorageAdapter contract with in-memory storage.
- `@forge-cms/api`: ApiContext and HTTP handler transport contracts.
- `@forge-cms/runtime`: ForgeCmsRuntime orchestrator, Local API, access checks, hooks, validation,
  relation population, globals, versions, live preview, localization, relation integrity, and
  framework-agnostic HTTP handlers.
- `@forge-cms/cloudflare`: Cloudflare D1 database adapter and R2 storage adapter.
- `@forge-cms/angular`: Angular client SDK (`CmsApiService`, `provideForgeCms`).
- `@forge-cms/admin`: Angular admin components for layout, document lists, forms, field controls,
  media picking, relation picking, and rich text editing.
- `@forge-cms/testing`: Shared adapter contract test suites.
- `apps/www`: Analog.js landing page + `/admin` demo + h3 server API (`/api/v1/*`).
- `apps/demo-aesthetics`: real-world demo app used to validate generic CMS ergonomics.
- CI/CD pipeline with GitHub Actions for lint, typecheck, tests, build, packed-artifact release
  verification, E2E, Cloudflare Pages deploy, and Changesets publish.

### Infrastructure

- pnpm workspaces + Turborepo.
- ESLint with TypeScript, import, and unicorn plugins.
- Prettier for code formatting.
- Changesets for version management and publishing.
- Cloudflare Pages deployment via Wrangler.
