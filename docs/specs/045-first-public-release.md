# 045 — Prepare first public release

- **Status:** done
- **Author:** agent draft from maintainer release brief
- **Date:** 2026-08-25
- **Branch:** main
- **Affected packages/apps:** all public `@forge-cms/*` packages, release tooling, docs

## Context / Why

ForgeCMS has never been published to npm, and workspace builds can hide package boundary mistakes.
The first public release must prove that a clean external project can install the exact packed
artifacts and use the public APIs without monorepo path aliases, workspace protocols, or hidden app
internals.

## Goal

Make `0.0.1` release-ready by aligning public package metadata, release state, docs, and CI around
packed-artifact external consumer validation.

## Non-goals

- No new CMS features.
- No API-key system, project-specific auth, translation management, page builder, GraphQL, or new
  database/framework integration.
- No architecture or package manager migration.
- No direct npm publication from this implementation pass.

## Design

All publishable ForgeCMS packages use version `0.0.1` for the first public baseline. The public
package family remains fixed-versioned with Changesets so future early releases are coordinated.

Public packages for `0.0.1` are:

- `@forge-cms/core`
- `@forge-cms/db`
- `@forge-cms/auth`
- `@forge-cms/storage`
- `@forge-cms/api`
- `@forge-cms/runtime`
- `@forge-cms/cloudflare`
- `@forge-cms/angular`
- `@forge-cms/admin`
- `@forge-cms/testing`

`@forge-cms/api` remains public because `@forge-cms/runtime` exposes framework-agnostic handlers that
accept its `ApiContext` contract, and external server integrations may need that type. The package is
documented as a small stable transport-contract package, not as an app framework.

`@forge-cms/testing` remains public for adapter authors and is published with compiled contract
exports only.

Release verification is implemented as a local script that:

1. Builds packages.
2. Packs every public package with `pnpm --filter <package> pack`.
3. Inspects packed manifests and tarball contents for unresolved workspace-only protocols and missing
   compiled files.
4. Creates isolated temporary consumer projects outside the workspace.
5. Installs the packed artifacts via `pnpm add /path/to/*.tgz`.
6. Compiles and runs a runtime CRUD smoke test with public APIs.
7. Compiles Cloudflare D1/R2 imports without Cloudflare credentials.
8. Compiles Angular and admin imports from packed artifacts with compatible peer dependencies.

The supported bootstrap pattern remains explicit:

```ts
const runtime = new ForgeCmsRuntime({ collections, adapters });
await runtime.init(env);
await runtime.syncSchema();
```

No new helper is introduced unless implementation proves the lifecycle is materially error-prone for
external consumers.

`runtime.syncSchema()` is documented honestly as additive schema synchronization, not a full migration
system.

## Implementation plan

- [x] Audit package manifests and public exports.
- [x] Align public package versions and Changesets config for the `0.0.1` baseline.
- [x] Clean historical pending changesets so `pnpm changeset status` reports the intended release.
- [x] Fix package metadata, exports, peer dependencies, and packed contents.
- [x] Add packed-artifact verification and isolated external consumer smoke tests.
- [x] Wire release verification into package scripts and CI.
- [x] Rewrite external-consumer quickstart and update README/release docs.
- [x] Update `docs/STATE.md` and close this spec.

## Test plan

- `pnpm build`
- `pnpm release:verify`
- `pnpm changeset status`
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## Acceptance criteria

1. Every public package is versioned `0.0.1` and has coherent publish metadata.
2. `pnpm changeset status` describes the intended first release without accumulated historical bumps.
3. Packed package manifests contain no `workspace:`, `catalog:`, `link:`, or `file:` dependency
   values.
4. Packed package contents contain compiled `.js` and `.d.ts` files and no workspace-only runtime
   imports.
5. A clean external project can install packed ForgeCMS runtime packages, compile, and execute CRUD.
6. A clean external project can compile Cloudflare adapter imports from packed packages.
7. A clean external Angular project can compile `@forge-cms/angular` and `@forge-cms/admin` imports
   from packed packages.
8. CI includes the packed-artifact release verification.
9. README and quickstart start from consumer installation, not cloning the monorepo.
10. Full quality gates pass.

## Open questions

None.

## Outcome

Shipped the `0.0.1` first-public-release baseline: public manifests are aligned, historical pending
changesets are cleared behind an empty baseline changeset, `@forge-cms/testing/contracts` now exports
compiled files, `pnpm release:verify` packs and externally installs the package family, CI runs the
packed-artifact verifier, and README/quickstart/status docs now describe external installation and
additive schema sync honestly. Verified with `pnpm release:verify`, `pnpm changeset status`,
`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm format:check`, and
`node --check scripts/verify-release.mjs`. `pnpm view` returned npm 404 for every intended public
package name, so none appear to be published yet; publication still requires npm account/scope
access.
