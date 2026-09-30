/**
 * The one place the website states which ForgeCMS release is current.
 *
 * The public `@forge-cms/*` packages are a fixed Changesets group — they always share one version —
 * so every package card derives from this constant. Update it when a release is published to npm,
 * not when a changeset merges: the Version Packages PR publishes on merge.
 *
 * Product checkpoints are a separate axis. npm `0.8.x` is the roadmap `0.7` (upgrade safety) line:
 * `0.8.0` carries M01, `0.8.1` added M02's code (its changelog entry is in `0.8.2`); roadmap `0.8`
 * (Angular DX) will publish as npm `0.9.0` — see `ROADMAP_MILESTONES` and docs/STATE.md.
 *
 * Verified 2026-09-30 (spec 075): npm `latest` is `0.8.2`. `main` manifests say `0.8.3` (Version
 * Packages PR #61), but that run's checks failed on a registry 404 and nothing was published.
 */
export const CURRENT_FORGE_VERSION = '0.8.2';

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
  { name: 'api', purpose: 'ApiContext and HTTP handler contracts' },
  { name: 'runtime', purpose: 'Local API, access, hooks, drafts, HTTP handlers' },
  { name: 'cloudflare', purpose: 'D1 database and R2 storage adapters' },
  { name: 'angular', purpose: 'Typed client, signal resources, auth session and guard' },
  { name: 'admin', purpose: 'Embeddable Angular admin: content, users, sign-in' },
  { name: 'testing', purpose: 'Adapter contract test suites' }
];
