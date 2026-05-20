# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial monorepo setup with pnpm workspaces and Turborepo
- `@forge-cms/core`: Schema DSL with strong TypeScript types and runtime validation
- `@forge-cms/db`: DatabaseAdapter contract with InMemory implementation
- `@forge-cms/auth`: AuthAdapter contract with InMemory implementation
- `@forge-cms/storage`: StorageAdapter contract with InMemory implementation
- `@forge-cms/api`: CRUD handler structure placeholder
- `@forge-cms/admin`: Admin package placeholder
- `@forge-cms/testing`: Shared test helpers and contract test suites
- CI/CD pipeline with GitHub Actions (lint, test, build, E2E, deploy)
- Landing app (`apps/www`) built with Angular, Analog.js, and TailwindCSS
- Playground app (`apps/playground`) for API experimentation

### Infrastructure

- ESLint with TypeScript, import, and unicorn plugins
- Prettier for code formatting
- Changesets for version management
- Cloudflare Pages deployment via Wrangler
