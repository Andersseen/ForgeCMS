# Contributing to ForgeCMS

Thank you for your interest in ForgeCMS. This guide covers the tooling, the pull-request workflow, the quality gates, and how releases happen. Agents and
maintainers should also read [CLAUDE.md](CLAUDE.md) (hard rules and gotchas) and [docs/CONVENTIONS.md](docs/CONVENTIONS.md).

## Requirements

- **Node.js >= 22** (`.nvmrc` pins the major; `engines` enforces it).
- **pnpm 10.11.0**, selected through the `packageManager` field (`corepack enable`). Never use npm or yarn: the workspace depends on pnpm's linking.
- Git. Docker is needed only for `pnpm test:s3` and `pnpm release:certify` (a real S3 service, Garage); Chromium for Playwright
  (`pnpm --filter @forge-cms/www exec playwright install chromium`).

```sh
git clone https://github.com/Andersseen/ForgeCMS.git
cd ForgeCMS
pnpm install
pnpm build        # required once: @forge-cms/* resolve through packages/*/dist (tsconfig.base.json)
```

## The repository

A **pnpm workspace** driven by **Turborepo**, ESM-only, TypeScript strict.

```
packages/   core · db · auth · storage · s3 · api · runtime · cloudflare · angular · admin · testing     (the eleven published packages)
apps/       www (site, docs, /admin demo) · playground (maintainer sandbox) · tiny-project (certification consumer)
            demo-aesthetics (real-world demo) · upgrade-rehearsal · performance-baseline
docs/       state, architecture, conventions, specs, roadmap, reference, support, dossier
scripts/    release, certification, quality, docs and staging tooling
```

Which package owns what, and the data flow: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Workflow

1. Branch from an up-to-date `main` (`feature/…`, `fix/…`). Do not work on `main`.
2. **Non-trivial changes start with a spec** in [docs/specs](docs/specs) ([docs/SDD.md](docs/SDD.md)): a new package, adapter, endpoint, field kind or runtime feature,
   or any change to an adapter contract or the API envelope. Past specs are also the record of why things are built the way they are.
3. Make the change with tests. New adapters must pass the contract suites from `@forge-cms/testing/contracts`.
4. Run the quality gates (below).
5. If you changed anything under `packages/*` (including a package `README.md`, which is part of the published tarball), add a **changeset**.
6. Open a pull request. CI runs the same gates plus certification; do not merge your own PR.
7. After meaningful work update [docs/STATE.md](docs/STATE.md).

## Quality gates

Before declaring work done:

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

| Command                                                           | Purpose                                                                                                                                                                 |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check:api`                                                  | Exported symbol names of every package against `api-baseline/*.json`. A real surface change updates the baseline (`pnpm check:api:update`) deliberately, in the same PR |
| `pnpm docs:verify`                                                | Documentation links, embedded snippets, the reference against the API baseline, stale-claim denylist                                                                    |
| `pnpm docs:verify:consumers`                                      | The two canonical quickstarts installed from packed tarballs into clean projects, built and run                                                                         |
| `pnpm test:cloudflare` / `test:libsql`                            | Real local workerd + D1 + R2 / real libSQL                                                                                                                              |
| `pnpm test:s3`                                                    | Real S3 service (Garage in Docker) for `@forge-cms/s3` and the durable-profile journeys                                                                                 |
| `pnpm test:upgrade`                                               | Historical-install upgrades and backup/restore rehearsal                                                                                                                |
| `pnpm test:coverage`                                              | Per-package source-attributed coverage against the 1.0 floors                                                                                                           |
| `pnpm test:performance`                                           | Fixed libSQL fixture and bundle sizes against frozen budgets                                                                                                            |
| `pnpm test:stability`                                             | Critical journeys repeated with retries off                                                                                                                             |
| `pnpm release:certify`                                            | Packs the eleven packages **once** and certifies exactly those tarballs (consumers, compat, SSR, S3, upgrade)                                                           |
| `pnpm e2e:www` · `e2e:www:prod` · `e2e:tiny-project` · `e2e:demo` | Playwright journeys                                                                                                                                                     |

CI (`.github/workflows/ci.yml`) is the authority: `Lint · Typecheck · Test · Build · Pack · E2E`, `Certify packed artifacts · durable profiles`,
`Reliability · Coverage · Performance`, `Changeset required` (pull requests) and, on `main`, the website/demo deployment and the npm release.

## Code style

TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`); `import type` for type-only imports; no floating promises; no import cycles; `node:` protocol
for Node builtins; relative imports inside `packages/*` use the `.js` extension; import packages only through their entry points. The full list is in
[docs/CONVENTIONS.md](docs/CONVENTIONS.md) and [CLAUDE.md](CLAUDE.md). Formatting is Prettier (`pnpm format`).

## Changesets and releases

The eleven public packages are one **fixed** Changesets group: they always release together at one version, whichever of them changed. Apps are private and never need a changeset.

```sh
pnpm changeset      # pick the packages, the bump (patch | minor | major) and write the summary
```

Choose the bump honestly: **patch** = compatible fix or documentation shipped in a package, **minor** = backward-compatible addition, **major** = breaking change to the stable
surface. See [docs/SUPPORT.md](docs/SUPPORT.md) for the policy. Commit the generated `.changeset/*.md`.

Releases are **driven by CI, not by hand**:

1. A change with a changeset merges to `main`. The `release` job (after `checks`, `certify` and `reliability` all pass) opens or updates a **"Version Packages"** pull request.
2. A maintainer reviews and merges that PR. Merging it is what publishes: the same job builds, runs `pnpm release:verify`, publishes the bumped packages to npm with provenance,
   and creates the GitHub release.
3. The website's `CURRENT_FORGE_VERSION` ([apps/www/src/app/forge-release.ts](apps/www/src/app/forge-release.ts)) is updated **after** a version is published, never when a changeset merges.

Do not run `changeset version` or `pnpm release` locally, do not bump manifests by hand, and never commit npm tokens or other secrets — publishing uses CI secrets only.
Release candidates and the 1.0 release follow [docs/roadmap/v1/1.0-release.md](docs/roadmap/v1/1.0-release.md).

## Documentation

Current-facing documentation is part of the product: `pnpm docs:verify` must pass, a snippet embedded from `docs/examples/*` is changed in the example file (and copied
into the page), and a claim in the docs must have evidence behind it. Historical specs are not rewritten.

## Security

Do not report vulnerabilities in a public issue — see [SECURITY.md](SECURITY.md). Questions and ordinary bugs: [GitHub issues](https://github.com/Andersseen/ForgeCMS/issues).
