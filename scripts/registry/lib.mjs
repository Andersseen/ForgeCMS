// Pure helpers for the explicit real-registry consumer mode (roadmap L02). Repository tooling only.
//
// The packed-tarball verifiers (`release:certify`) prove what WE are about to publish. These helpers back
// `pnpm registry:consumers`, which proves what npm actually serves: exact versions, resolved from the
// registry into a fresh project outside the monorepo with its own empty package store.
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** A registry check must name one exact version: never a range, a dist-tag, `latest`, `file:` or `workspace:`. */
export function assertExactVersion(version) {
  if (typeof version !== 'string' || !EXACT_VERSION.test(version)) {
    throw new Error(
      `registry consumers need one exact version (for example 1.0.0-rc.2), got ${JSON.stringify(version)}`
    );
  }
  return version;
}

/** `name → exact version` for the given packages: the dependency block and the pnpm override block alike. */
export function registrySpecs(names, version) {
  assertExactVersion(version);
  return Object.fromEntries(names.map((name) => [name, version]));
}

/** `{ name, version }` of every `@forge-cms/*` entry in the `packages:` section of a pnpm-lock.yaml. */
export function lockedForgePackages(lockText) {
  const found = [];
  const section = /^packages:\n([\s\S]*?)(?:^\S|(?![\s\S]))/m.exec(lockText)?.[1] ?? '';
  for (const match of section.matchAll(/^ {2}'?(@forge-cms\/[^@'\s]+)@([^':\s]+)'?:/gm)) {
    found.push({ name: match[1], version: match[2] });
  }
  return found;
}

/**
 * Problems with a consumer's lockfile (never throws): exactly the expected Forge packages, every one at the
 * requested version (no mixed 0.13.4 / rc.2), each resolved from the registry by integrity — no local tarball,
 * directory, link, file or workspace resolution anywhere.
 */
export function lockfileProblems(lockText, { version, names }) {
  const problems = [];
  const locked = lockedForgePackages(lockText);
  const expected = new Set(names);
  for (const { name, version: lockedVersion } of locked) {
    if (!expected.has(name)) problems.push(`unexpected Forge package in the lockfile: ${name}`);
    if (lockedVersion !== version) {
      problems.push(`${name} resolved to ${lockedVersion}, expected exactly ${version}`);
    }
  }
  for (const name of expected) {
    if (!locked.some((entry) => entry.name === name))
      problems.push(`${name} is not in the lockfile`);
  }
  for (const { name, version: lockedVersion } of locked) {
    const entry = new RegExp(
      `^ {2}'?${name.replace('/', '\\/')}@${lockedVersion.replace(/[.+]/g, '\\$&')}'?:\\n((?: {4}.*\\n)+)`,
      'm'
    ).exec(lockText);
    const body = entry?.[1] ?? '';
    if (!/integrity: sha512-/.test(body)) problems.push(`${name} has no registry integrity hash`);
    if (/tarball:|directory:|type: git/.test(body)) {
      problems.push(`${name} is not resolved from the registry`);
    }
  }
  for (const marker of ['link:', 'file:', 'workspace:', 'directory:']) {
    if (new RegExp(`(?:specifier|version|resolution):.*\\b${marker}`).test(lockText)) {
      problems.push(`the lockfile contains a ${marker} resolution`);
    }
  }
  return problems;
}

/** Problems with the installed tree: each Forge package is a real directory of the requested version. */
export function installedProblems(projectDir, { version, names }) {
  const problems = [];
  for (const name of names) {
    const dir = join(projectDir, 'node_modules', name);
    if (!existsSync(dir)) {
      problems.push(`${name} is not installed`);
      continue;
    }
    const real = realpathSync(dir);
    if (!real.includes(`${sep}.pnpm${sep}`)) {
      problems.push(`${name} resolves outside the package store: ${real}`);
    }
    const installed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (installed.version !== version) {
      problems.push(`${name} installed as ${installed.version}, expected ${version}`);
    }
    for (const section of ['dependencies', 'peerDependencies']) {
      for (const [dep, range] of Object.entries(installed[section] ?? {})) {
        if (dep.startsWith('@forge-cms/') && range !== version && range !== `^${version}`) {
          problems.push(`${name} ${section}.${dep} is ${range}, expected ${version}`);
        }
      }
    }
  }
  return problems;
}

/** The consumer must not be inside the monorepo, nor under any pnpm workspace root. */
export function workspaceProblems(projectDir, repoRoot) {
  const problems = [];
  const real = realpathSync(projectDir);
  const repo = realpathSync(repoRoot);
  if (real === repo || real.startsWith(repo + sep))
    problems.push('the consumer is inside the repository');
  for (let dir = dirname(real); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      problems.push(`an ancestor directory is a pnpm workspace: ${dir}`);
    }
    if (dirname(dir) === dir) break;
  }
  if (lstatSync(projectDir).isSymbolicLink()) problems.push('the consumer directory is a symlink');
  return problems;
}

/**
 * The environment an isolated install runs in: a private empty package store and cache (so nothing built or
 * cached locally can satisfy a Forge dependency), the public registry, and none of the variables a
 * `pnpm run`/certification parent would leak (`npm_config_*`, `FORGE_CERT_ARTIFACTS`).
 */
export function isolatedEnv(baseEnv, { storeDir, cacheDir }) {
  const env = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (/^npm_(config|package|lifecycle)_/i.test(key)) continue;
    if (key === 'FORGE_CERT_ARTIFACTS' || key === 'INIT_CWD' || key === 'PNPM_SCRIPT_SRC_DIR')
      continue;
    env[key] = value;
  }
  return {
    ...env,
    npm_config_store_dir: resolve(storeDir),
    npm_config_cache: resolve(cacheDir),
    npm_config_registry: 'https://registry.npmjs.org/',
    CI: 'true'
  };
}

/** Strict peers, no automatic peer installation, public registry — written to the consumer's `.npmrc`. */
export const REGISTRY_NPMRC =
  'strict-peer-dependencies=true\nauto-install-peers=false\nregistry=https://registry.npmjs.org/\n';
