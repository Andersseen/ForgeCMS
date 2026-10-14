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
 * Verified 2026-10-14 (spec 092): all eleven `@forge-cms/*` packages report `0.13.4` on npm (`latest`) after PR #98 — Version Packages — was merged;
 * `0.13.4` is the R04 README-only patch (package READMEs and docs). `0.13.3` was the R03 metadata-privacy patch. A `1.0.0-rc.N` published under the
 * `rc` dist-tag does NOT move this constant: it stays on the stable line until 1.0.0 ships (spec 092).
 * The website reports the published fixed-group release, independently of unmerged roadmap work.
 */
export const CURRENT_FORGE_VERSION = '0.13.4';

/**
 * Registry truth for the 1.0 candidate, verified 2026-10-14 (spec 094): npm `latest` is the stable
 * `0.13.4`, no `rc` dist-tag exists and `@forge-cms/agent` is not on the registry (E404).
 *
 * Flip these only after the maintainer publishes the release candidate and the registry confirms it
 * (`npm view @forge-cms/agent dist-tags`). Every "available in the RC" word and every `@rc` install
 * command on the site derives from them, so an unpublished package can never show a working install.
 */
export const FORGE_CHANNELS = {
  /** A `1.0.0-rc.N` exists under the npm `rc` dist-tag. */
  rcPublished: false,
  /** `@forge-cms/agent` exists on the registry (it first ships with the RC). */
  agentPublished: false
} as const;

/** How a visitor should read a package: part of the frozen 1.0 surface, or experimental. */
export type ForgeAvailability = 'stable' | 'experimental';

export interface ForgePackage {
  /** The name after `@forge-cms/`. */
  name: string;
  purpose: string;
  availability: ForgeAvailability;
}

/** The version label a package card shows: the stable line, or the honest channel for newer packages. */
export function packageVersionLabel(pkg: Pick<ForgePackage, 'name'>): string {
  if (pkg.name !== 'agent') return CURRENT_FORGE_VERSION;
  return FORGE_CHANNELS.agentPublished ? 'rc' : 'RC · not yet published';
}

/** The install command for the experimental Agent Kit, or `null` while it is unpublished. */
export function agentInstallCommand(): string | null {
  return FORGE_CHANNELS.agentPublished ? 'pnpm add -D @forge-cms/agent@rc' : null;
}

/** Every public package, in dependency order. */
export const FORGE_PACKAGES: readonly ForgePackage[] = [
  {
    name: 'core',
    purpose: 'Schema DSL, validation, collection and global definitions',
    availability: 'stable'
  },
  {
    name: 'db',
    purpose: 'Database contract, InMemory and libSQL adapters, schema sync',
    availability: 'stable'
  },
  { name: 'auth', purpose: 'Users collection auth, sessions, API keys', availability: 'stable' },
  { name: 'storage', purpose: 'Storage contract and InMemory adapter', availability: 'stable' },
  {
    name: 's3',
    purpose: 'S3-compatible StorageAdapter for portable durable file storage',
    availability: 'stable'
  },
  { name: 'api', purpose: 'ApiContext and HTTP handler contracts', availability: 'stable' },
  {
    name: 'runtime',
    purpose: 'Local API, access, hooks, drafts, HTTP handlers',
    availability: 'stable'
  },
  { name: 'cloudflare', purpose: 'D1 database and R2 storage adapters', availability: 'stable' },
  {
    name: 'angular',
    purpose: 'Typed client, signal resources, auth session and guard',
    availability: 'stable'
  },
  {
    name: 'admin',
    purpose: 'Embeddable Angular admin: content, users, sign-in',
    availability: 'stable'
  },
  { name: 'testing', purpose: 'Adapter contract test suites', availability: 'stable' },
  {
    name: 'agent',
    purpose: 'Read-only MCP server and official skills for coding agents',
    availability: 'experimental'
  }
];
