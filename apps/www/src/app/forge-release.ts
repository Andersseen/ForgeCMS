/**
 * The one place the website states which ForgeCMS release is current.
 *
 * The public `@forge-cms/*` packages are a fixed Changesets group — they always share one version —
 * so every package card derives from this constant. Update it when a release is published to npm,
 * not when a changeset merges: the Version Packages PR publishes on merge.
 *
 * Product checkpoints are a separate axis. npm `0.8.x` is the roadmap `0.7` (upgrade safety) line:
 * `0.8.0` carries M01, `0.8.1` added M02's code (its changelog entry is in `0.8.2`); roadmap `0.8`
 * (Angular DX) published as npm `0.9.0`; roadmap `0.9` (SSR) is the npm `0.10.x` line; roadmap `0.10` (portable storage) is the npm `0.11.x` line (`0.11.0` added `@forge-cms/s3`); roadmap `0.11` (admin) is the npm `0.12.x` line (`0.12.0` = U01, `0.12.1` = U02) and completed with `0.13.0` (U03, the 1.0 surface freeze); `0.13.1` and `0.13.2` are patch releases (roadmap 0.12 R02 fixes; R03 K3 D1 `in`-list fix) — see `ROADMAP_MILESTONES` and docs/STATE.md.
 *
 * Verified 2026-10-12 (spec 090): all eleven `@forge-cms/*` packages report `0.13.2` on npm (`latest`) and GitHub has release
 * `v0.13.2` (published by main CI run `38143496339` of `3eb46aa`, after PR #94 — Version Packages — was merged).
 * The website reports the published fixed-group release, independently of unmerged roadmap work.
 */
export const CURRENT_FORGE_VERSION = '0.13.2';

export interface ForgePackage {
  /** The name after `@forge-cms/`. */
  name: string;
  purpose: string;
}

/** Every public package, in dependency order. */
export const FORGE_PACKAGES: readonly ForgePackage[] = [
  { name: 'core', purpose: 'Schema DSL, validation, collection and global definitions' },
  { name: 'db', purpose: 'Database contract, InMemory and libSQL adapters, schema sync' },
  { name: 'auth', purpose: 'Users collection auth, sessions, API keys' },
  { name: 'storage', purpose: 'Storage contract and InMemory adapter' },
  { name: 's3', purpose: 'S3-compatible StorageAdapter for portable durable file storage' },
  { name: 'api', purpose: 'ApiContext and HTTP handler contracts' },
  { name: 'runtime', purpose: 'Local API, access, hooks, drafts, HTTP handlers' },
  { name: 'cloudflare', purpose: 'D1 database and R2 storage adapters' },
  { name: 'angular', purpose: 'Typed client, signal resources, auth session and guard' },
  { name: 'admin', purpose: 'Embeddable Angular admin: content, users, sign-in' },
  { name: 'testing', purpose: 'Adapter contract test suites' }
];
