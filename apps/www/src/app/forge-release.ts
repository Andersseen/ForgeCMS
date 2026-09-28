/**
 * The one place the website states which ForgeCMS release is current.
 *
 * The public `@forge-cms/*` packages are a fixed Changesets group — they always share one version —
 * so every package card derives from this constant. Update it when a release is published to npm,
 * not when a changeset merges: the Version Packages PR publishes on merge.
 *
 * Product checkpoints are a separate axis. Roadmap `0.7` (upgrade safety) is in progress while npm
 * `0.7.0` carries the completed roadmap `0.6` work — see `ROADMAP_MILESTONES` and docs/STATE.md.
 */
export const CURRENT_FORGE_VERSION = '0.7.0';

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
