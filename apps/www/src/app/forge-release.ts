import type { SiteMessageKey } from './i18n/i18n';

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
  /** Catalog key of the one-line purpose (spec 101). */
  purpose: SiteMessageKey;
  availability: ForgeAvailability;
}

/**
 * The version a package card shows: the stable line, or `null` for a package not on npm yet (the card
 * then says so in the reader's language).
 */
export function packageVersionLabel(pkg: Pick<ForgePackage, 'name'>): string | null {
  if (pkg.name === 'agent' && !FORGE_CHANNELS.agentPublished) return null;
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
    purpose: 'packages.purpose.core',
    availability: 'stable'
  },
  {
    name: 'db',
    purpose: 'packages.purpose.db',
    availability: 'stable'
  },
  { name: 'auth', purpose: 'packages.purpose.auth', availability: 'stable' },
  { name: 'storage', purpose: 'packages.purpose.storage', availability: 'stable' },
  {
    name: 's3',
    purpose: 'packages.purpose.s3',
    availability: 'stable'
  },
  { name: 'api', purpose: 'packages.purpose.api', availability: 'stable' },
  {
    name: 'runtime',
    purpose: 'packages.purpose.runtime',
    availability: 'stable'
  },
  { name: 'cloudflare', purpose: 'packages.purpose.cloudflare', availability: 'stable' },
  {
    name: 'angular',
    purpose: 'packages.purpose.angular',
    availability: 'stable'
  },
  {
    name: 'admin',
    purpose: 'packages.purpose.admin',
    availability: 'stable'
  },
  { name: 'testing', purpose: 'packages.purpose.testing', availability: 'stable' },
  {
    name: 'agent',
    purpose: 'packages.purpose.agent',
    availability: 'experimental'
  }
];
