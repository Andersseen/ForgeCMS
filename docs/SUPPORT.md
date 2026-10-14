# Support, compatibility and deprecation policy

How ForgeCMS versions, what is supported, and what a "supported" claim is backed by. Security reporting is in [../SECURITY.md](../SECURITY.md); deliberate scope boundaries are in
[LIMITATIONS.md](LIMITATIONS.md); the status of each capability is in [MATRICES.md](MATRICES.md).

## One version for twelve packages

`@forge-cms/core`, `db`, `auth`, `storage`, `s3`, `api`, `runtime`, `cloudflare`, `angular`, `admin`, `testing` and the experimental `agent` form one Changesets **fixed** group: they are always released
together at the same version, and you should install matching versions. The current release is **`0.13.4`**. Roadmap checkpoints (0.5–0.12) are planning labels, not versions.

## Semantic versioning from 1.0

ForgeCMS follows [semver](https://semver.org) for the **stable** surface: everything listed as stable in [REFERENCE.md](REFERENCE.md) and [1.0-PUBLIC-SURFACE.md](1.0-PUBLIC-SURFACE.md) —
exported names (`api-baseline/*.json`, checked in CI), documented options and defaults, the REST envelope, and documented behaviour.

| Release | Contains                                                                                              |
| ------- | ----------------------------------------------------------------------------------------------------- |
| PATCH   | Backward-compatible bug fixes, security fixes, compatibility fixes, documentation shipped in packages |
| MINOR   | Backward-compatible additions (new exports, options with unchanged defaults, new supported ranges)    |
| MAJOR   | Any breaking change to the stable surface, or dropping a supported range                              |

Because the family is fixed, a patch to one package is a patch of all twelve. Changing a documented default is a breaking change. Before 1.0 (the current `0.x` line) the frozen
surface changes only to fix a release blocker.

**Not covered by the promise:** the whole `@forge-cms/agent` package (the experimental Agent Kit: its MCP tools, resources and skills), experimental APIs (Cloudflare Analytics: the Analytics Engine writer/query client, `provideForgeAnalytics` and its tracker/service, the admin analytics route and dashboard),
anything not exported from an entry point, deep imports into `src/` or `dist/`, internal collections and fields (`_forge_*`, `_storageKey`, `_sessionVersion`), the exact text of error messages (use
`code`/`kind`), and the repository's apps (`apps/*`).

## Deprecation policy

- A stable API is **deprecated in a documented release before it is removed**, with a replacement path in the docs and changelog.
- Deprecated APIs keep working (possibly as no-ops) for the rest of that major line. Removal happens in the next major, not within 1.x, unless a safety or security problem makes keeping it
  irresponsible — in which case the reason is stated in the release notes.
- Currently deprecated: `ForgeAdminConfig.logo` and `ForgeAdminConfig.features` (never had an effect; removed after 1.0).
- Experimental APIs may change or disappear in any release; the changelog says so when they do.

## Supported ranges versus tested versions

A **supported range** is what the package manifests declare (peer ranges / engines): we intend it to work and will fix a defect in it. A **tested version** is a concrete tuple a gate actually
built and ran. We do not claim every patch inside a range was tested. If something in a range but outside the tested tuples breaks, that is a bug to report; it is not a certification.

| Component              | Supported range                                  | Actually tested                                                                                                   | Gate                                |
| ---------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Node.js                | `>= 22`                                          | 22 (`.nvmrc`, CI image)                                                                                           | all CI                              |
| pnpm                   | `>= 10`                                          | 10.11.0                                                                                                           | all CI                              |
| TypeScript             | strict ESM (not a declared peer)                 | 5.9.2; `~5.9.2` newest in the Angular 21 matrix; `~6.0.0` in the Angular 22 client-only fixture                   | `release:compat`, consumers         |
| Angular — client       | `@angular/core`, `router` `^21.0.0 \|\| ^22.0.0` | 21.0.0 (minimum) · 21.2.10 (current) · newest 21.2.x (last recorded 21.2.25) · newest 22.x (last recorded 22.2.1) | `pnpm release:compat`               |
| Angular — admin        | `^21.2.0` (all `@angular/*` peers)               | 21.2.0 (minimum) · 21.2.10 (current) · newest 21.2.x                                                              | `pnpm release:compat`               |
| `@angular/cdk`         | `^21.2.0` (admin only)                           | 21.2.0 · 21.2.10 · newest 21.2.x                                                                                  | `release:compat`                    |
| RxJS                   | `^7.8.0` (admin)                                 | 7.8.0 · 7.8.2                                                                                                     | `release:compat`                    |
| `@voltui/components`   | `^1.0.1` (admin)                                 | 1.0.1 · 1.1.0 · newest 1.x                                                                                        | `release:compat`                    |
| `lumen-icons`          | `^0.2.0` (admin)                                 | 0.2.0 · newest 0.2.x                                                                                              | `release:compat`                    |
| Vite (linker)          | `^7.0.0 \|\| ^8.0.0` (optional peer)             | 7.0.0 · 7.1.4 · newest 8.x                                                                                        | `release:compat`                    |
| `@babel/core` (linker) | `^7.28.0 \|\| ^8.0.0` (8 required by Angular 22) | 7.28.0 · 7.29.0 · newest 7.x · 8.x with Angular 22                                                                | `release:compat`                    |
| Analog.js              | not a Forge peer                                 | `@analogjs/platform` 2.5.2 with `@analogjs/vite-plugin-angular` 2.4.8 (and ^2.8 for Angular 22)                   | `release:ssr`, quickstart consumers |
| libSQL client          | pinned dependency of `@forge-cms/db`             | `@libsql/client` 0.17.3 with `drizzle-orm` 0.45.2                                                                 | `test:libsql`, `test:upgrade`       |
| Wrangler / workerd     | operator tool                                    | Wrangler 4.91.0 (local workerd and the remote staging rehearsal)                                                  | `test:cloudflare`, spec 090         |
| Garage (S3)            | any S3-compatible service is _configurable_      | Garage `v2.4.1` (pinned digest) — the only certified service                                                      | `test:s3`                           |
| AWS SDK v3             | pinned dependency of `@forge-cms/s3`             | `@aws-sdk/client-s3` 3.1147.0                                                                                     | `test:s3`                           |
| Playwright             | repository tooling only                          | 1.60.0                                                                                                            | e2e                                 |

**Angular 22:** `@forge-cms/angular` is tested on Angular 22 (client only, with Babel 8). `@forge-cms/admin` is **not** supported on Angular 22 — it inherits `@voltui/components` 1.x's
Angular 21 peer. Angular 19 and 20 are not supported.

**Browsers and operating systems:** the admin is exercised in Chromium (Playwright) with WCAG 2.2 AA scans; CI runs on Linux. Other browsers and operating systems are expected to work but are not gated.

## What "supported" and "certified" mean

- _Supported_: documented behaviour in a supported range; a reproducible defect is fixed in a patch.
- _Certified_: a named gate ran on exact packed artifacts (`pnpm release:certify`) or a recorded rehearsal ran against real services. The evidence is in the [release dossier](1.0-RELEASE-DOSSIER.md).
- Isolated Cloudflare staging (spec 090) supports the Cloudflare profile; it is not a certification of your deployment, and ForgeCMS has no uptime commitment.

## Getting help

Bugs and questions: [GitHub issues](https://github.com/Andersseen/ForgeCMS/issues). Include versions of all `@forge-cms/*` packages, Node, the framework, and the profile you deploy. Support is
best-effort by an individual maintainer; there is no SLA. Vulnerabilities: [../SECURITY.md](../SECURITY.md) — not a public issue.
