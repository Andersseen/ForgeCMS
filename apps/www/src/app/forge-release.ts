/**
 * The one place the website states which ForgeCMS release is current.
 *
 * The public `@forge-cms/*` packages are a fixed Changesets group — they always share one version —
 * so every package card derives from this constant. Update it when a release is published to npm,
 * not when a changeset merges: the Version Packages PR publishes on merge.
 *
 * Product milestones are a separate axis from package versions. The current milestone definitions
 * and status live in `docs/roadmap/v2/milestones.json`; the V1 checkpoint history remains in docs.
 *
 * Stable publication recorded by main CI run 39063229523 (2026-10-17): all twelve fixed-family
 * packages were published at 1.0.0 and the GitHub v1.0.0 release targets the stable-version merge.
 */
export const CURRENT_FORGE_VERSION = '1.0.0';

/**
 * The accepted release candidate remains part of release history after stable publication.
 */
export const CURRENT_RC_VERSION = '1.0.0-rc.2';

/**
 * Publication state recorded by the successful main release workflow. The candidate remains available as
 * release history; the fixed package family now installs from the stable `latest` line.
 */
export const FORGE_CHANNELS = {
  /** A `1.0.0-rc.N` exists in release history on npm. */
  rcPublished: true,
  /** The stable fixed family was published at 1.0.0. */
  stablePublished: true,
  /** `@forge-cms/agent` exists on npm; the package remains experimental. */
  agentPublished: true
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
  if (pkg.name === 'agent' && !FORGE_CHANNELS.agentPublished) return 'not yet published';
  return CURRENT_FORGE_VERSION;
}

/** The install command for the experimental Agent Kit, or `null` while it is unpublished. */
export function agentInstallCommand(): string | null {
  return FORGE_CHANNELS.agentPublished
    ? `pnpm add -D @forge-cms/agent@${CURRENT_FORGE_VERSION}`
    : null;
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
