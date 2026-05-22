# Contributing to ForgeCMS

Thank you for your interest in contributing to ForgeCMS! This document provides guidelines and workflows to help you get started.

## Development Setup

### Prerequisites

- **Node.js** >= 20.19.0 (use `.nvmrc` for exact version)
- **pnpm** >= 10.0.0 (managed via `corepack` or `packageManager` field)

### Installation

```sh
# Install dependencies
pnpm install

# Verify setup
pnpm test
pnpm lint
pnpm typecheck
```

## Monorepo Workflow

This project uses **pnpm workspaces** + **Turborepo**. Key commands:

| Command           | Description                 |
| ----------------- | --------------------------- |
| `pnpm dev`        | Start all apps in dev mode  |
| `pnpm dev:www`    | Start landing app only      |
| `pnpm build`      | Build all packages and apps |
| `pnpm test`       | Run all tests               |
| `pnpm test:watch` | Run tests in watch mode     |
| `pnpm lint`       | Lint all packages           |
| `pnpm typecheck`  | Type-check all packages     |
| `pnpm format`     | Format code with Prettier   |
| `pnpm clean`      | Clean all build artifacts   |

## Making Changes

1. **Create a branch** from `main`
2. **Make your changes** with tests if applicable
3. **Run the quality checks** before committing:
   ```sh
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build
   ```
4. **Add a changeset** if your change affects any published package:
   ```sh
   npx changeset
   ```
5. **Submit a PR** — CI will run automatically

## Adding a Changeset

We use [Changesets](https://github.com/changesets/changesets) for version management.

```sh
npx changeset
# Select affected packages
# Choose semver bump: patch | minor | major
# Write a summary
```

Changeset files are stored in `.changeset/` and will be consumed during release.

## Package Structure

```
packages/
  core/       # Schema DSL and types (published)
  db/         # Database adapter contracts (published)
  auth/       # Auth adapter contracts (published)
  storage/    # Storage adapter contracts (published)
  api/        # CRUD/API helpers (published)
  admin/      # Angular admin placeholder (published)
  testing/    # Shared test utilities (published)
```

Each package:

- Must have `type: "module"` (ESM only)
- Must pass `lint`, `typecheck`, and `test`
- Should have `sideEffects: false`

## Code Style

- **TypeScript strict mode** is required
- Use `type` imports when possible (`import type { Foo }`)
- Prefer `node:` protocol for built-in modules (`import { readFile } from 'node:fs'`)
- No floating promises without `await` or `.catch()`
- No cyclic imports (`import/no-cycle`)

## Testing

- **Unit tests**: Vitest (`*.test.ts` files)
- **Contract tests**: Use helpers from `@forge-cms/testing` for adapter implementations
- **E2E tests**: Playwright for `apps/www`

## Release Process

We use [Changesets](https://github.com/changesets/changesets) to manage versioning and publishing.

### For contributors (adding a changeset)

When your PR includes changes that should be published:

```sh
pnpm changeset
# Select affected packages
# Choose semver bump: patch | minor | major
# Write a summary
```

Commit the generated `.changeset/*.md` file along with your changes.

### For maintainers (publishing)

```sh
# 1. Review and merge changeset PRs
# 2. Version packages (bumps versions and updates changelogs)
pnpm changeset:version

# 3. Create a release commit
git add .
git commit -m "chore: version packages"
git push

# 4. Publish to npm (requires npm auth)
pnpm release
```

All packages are published under the `@forge-cms` scope with `access: public`. The `latest` tag is used by default; alpha releases can be tagged manually if needed.

## Questions?

Open an issue or discussion on GitHub. We're happy to help!
