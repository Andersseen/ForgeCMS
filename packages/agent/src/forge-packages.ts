/** The public `@forge-cms/*` packages an application may depend on (the agent kit is tooling, listed apart). */
export const FORGE_RUNTIME_PACKAGES = [
  '@forge-cms/core',
  '@forge-cms/db',
  '@forge-cms/auth',
  '@forge-cms/storage',
  '@forge-cms/s3',
  '@forge-cms/api',
  '@forge-cms/runtime',
  '@forge-cms/cloudflare',
  '@forge-cms/angular',
  '@forge-cms/admin',
  '@forge-cms/testing'
] as const;

export const FORGE_AGENT_PACKAGE = '@forge-cms/agent';

/** Packages that must never be imported from browser code. */
export const SERVER_ONLY_PACKAGES = [
  '@forge-cms/runtime',
  '@forge-cms/db',
  '@forge-cms/auth',
  '@forge-cms/s3',
  '@forge-cms/cloudflare',
  '@forge-cms/storage',
  '@forge-cms/agent'
] as const;
