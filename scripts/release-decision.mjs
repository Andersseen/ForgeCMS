// Pure release decisions (spec 072 §9), kept apart from the scripts' I/O so `node --test` can pin them.

/**
 * Whether this push may create the aggregate `vX.Y.Z` GitHub release.
 *
 * Only the commit that introduced a version may carry its tag. Before spec 072 the release step tagged
 * whatever `main` HEAD it ran on, so when the publishing run failed before tagging, the next unrelated
 * push created `v0.6.0`/`v0.7.0` one merge too late.
 *
 * @param {{ head: { name: string, version: string }[], base: { name: string, version: string }[] | null }} input
 *   `head`: public packages at HEAD. `base`: the same at HEAD's first parent, or `null` when it cannot be
 *   read (shallow checkout, root commit) — then no tag: a missing tag is recoverable by hand, a wrong one
 *   silently misleads.
 * @returns {{ create: boolean, version: string | null, reason: string }}
 */
export function decideAggregateRelease({ head, base }) {
  const headVersions = new Set(head.map((pkg) => pkg.version));
  if (head.length === 0) return { create: false, version: null, reason: 'no public packages' };
  if (headVersions.size !== 1) {
    const summary = head.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ');
    throw new Error(`Expected all public packages to share one fixed version. Found: ${summary}`);
  }
  const version = head[0].version;
  if (base === null) {
    return {
      create: false,
      version,
      reason: 'first-parent package versions are unreadable; refusing to guess the release commit'
    };
  }
  const baseVersions = new Map(base.map((pkg) => [pkg.name, pkg.version]));
  const introduced = head.some((pkg) => baseVersions.get(pkg.name) !== version);
  return introduced
    ? { create: true, version, reason: `this commit introduces ${version}` }
    : {
        create: false,
        version,
        reason: `${version} was already the version at the first parent; this push did not release it`
      };
}

/**
 * The commit whose release this run decides: the push that triggered it (`GITHUB_SHA`), never `HEAD`.
 * When the same run also opens or updates a Version Packages PR, `changesets/action` leaves `HEAD` on
 * its own `changeset-release/main` commit, whose first parent is the triggering commit — comparing
 * `HEAD^1` then reported "already the version at the first parent" and `v0.8.1` was never tagged
 * (spec 073). Outside CI there is no `GITHUB_SHA`, and `HEAD` is the only sensible default.
 *
 * @param {Record<string, string | undefined>} env
 */
export function releaseCommit(env) {
  const sha = env.GITHUB_SHA?.trim();
  return sha ? sha : 'HEAD';
}

/**
 * npm's answers for "that version already exists", including the short window right after
 * `changeset publish` in which `npm view` still says 404 but a second publish is refused (the `v0.7.0`
 * run failed exactly here). Treated as already published, never as a failure.
 *
 * @param {string} output combined stdout/stderr of `pnpm publish`
 */
export function isAlreadyPublishedError(output) {
  return (
    /\bE409\b[\s\S]*previously staged version/i.test(output) ||
    /\bE403\b[\s\S]*cannot publish over the previously published versions?/i.test(output) ||
    /You cannot publish over the previously published versions?/i.test(output)
  );
}

// ---------------------------------------------------------------------------------------------------
// Prerelease safety (spec 092). npm publishes to `latest` unless told otherwise, and Changesets does not
// protect that for us, so every publication path states its mode and tag explicitly.
// ---------------------------------------------------------------------------------------------------

/** The one fixed public package family (`.changeset/config.json` → `fixed`). */
export const PUBLIC_FAMILY = [
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
];

/** The single npm dist-tag a ForgeCMS release candidate publishes under. */
export const RC_TAG = 'rc';

const stablePattern = /^\d+\.\d+\.\d+$/;
const prereleasePattern = /^\d+\.\d+\.\d+-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*$/;
const rcPattern = /^1\.0\.0-rc\.\d+$/;
const tagPattern = /^[a-z][a-z0-9-]*$/;

/**
 * `stable` for `X.Y.Z`, `prerelease` for `X.Y.Z-id[.n]`. Anything else (build metadata, garbage) throws:
 * a version we cannot classify must never be published.
 *
 * @param {string} version
 * @returns {'stable' | 'prerelease'}
 */
export function classifyVersion(version) {
  if (typeof version === 'string' && stablePattern.test(version)) return 'stable';
  if (typeof version === 'string' && prereleasePattern.test(version)) return 'prerelease';
  throw new Error(`Unrecognised package version: ${JSON.stringify(version)}`);
}

/** Whether `version` is a ForgeCMS 1.0 release candidate (`1.0.0-rc.N`). */
export function isRcVersion(version) {
  return typeof version === 'string' && rcPattern.test(version);
}

/**
 * The release mode of the whole public family at HEAD: `stable`, `prerelease`, or `none` (no public
 * packages). A family that mixes stable and prerelease versions is refused.
 *
 * @param {{ name: string, version: string }[]} packages
 * @returns {'stable' | 'prerelease' | 'none'}
 */
export function detectReleaseMode(packages) {
  if (packages.length === 0) return 'none';
  const modes = new Set(packages.map((pkg) => classifyVersion(pkg.version)));
  if (modes.size !== 1) {
    const summary = packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ');
    throw new Error(`Public packages mix stable and prerelease versions: ${summary}`);
  }
  return [...modes][0];
}

/**
 * The npm dist-tag a publication must use, or throws. Fail-closed:
 * - stable version, no tag → `null` (npm default `latest`, existing behaviour);
 * - stable version with an explicit tag → refused (the stable path never takes a custom tag);
 * - prerelease version → an explicit tag is mandatory and may not be `latest`.
 *
 * @param {string} version
 * @param {string | undefined} tag
 * @returns {string | null}
 */
export function resolvePublishTag(version, tag) {
  const mode = classifyVersion(version);
  if (tag !== undefined && !tagPattern.test(tag)) {
    throw new Error(`Invalid npm dist-tag ${JSON.stringify(tag)}`);
  }
  if (mode === 'stable') {
    if (tag !== undefined) {
      throw new Error(`Stable version ${version} must publish without --tag (got "${tag}")`);
    }
    return null;
  }
  if (tag === undefined) {
    throw new Error(
      `Prerelease ${version} requires an explicit --tag (e.g. --tag ${RC_TAG}); refusing implicit "latest"`
    );
  }
  if (tag === 'latest') {
    throw new Error(`Prerelease ${version} must never publish under the "latest" tag`);
  }
  return tag;
}

/**
 * Asserts the family is exactly `PUBLIC_FAMILY`, with one shared version.
 *
 * @param {{ name: string, version: string }[]} packages
 * @returns {string} the shared version
 */
export function assertFixedFamily(packages) {
  const names = packages.map((pkg) => pkg.name).sort();
  const expected = [...PUBLIC_FAMILY].sort();
  if (names.length !== expected.length || names.some((name, i) => name !== expected[i])) {
    throw new Error(`Public package set differs from the fixed family. Found: ${names.join(', ')}`);
  }
  const versions = new Set(packages.map((pkg) => pkg.version));
  if (versions.size !== 1) {
    const summary = packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ');
    throw new Error(`Expected all public packages to share one fixed version. Found: ${summary}`);
  }
  return packages[0].version;
}

/**
 * The GitHub release to create for a version: tag `vX`, `prerelease` iff the version is a prerelease.
 *
 * @param {string} version
 * @returns {{ tagName: string, prerelease: boolean }}
 */
export function githubReleasePlan(version) {
  return { tagName: `v${version}`, prerelease: classifyVersion(version) === 'prerelease' };
}

/**
 * Whether npm `latest` is an acceptable stable pointer: it must be a stable version, and (after a
 * publication) unchanged from before.
 *
 * @param {string} before `latest` before publishing
 * @param {string} [after] `latest` after publishing
 */
export function assertLatestSafe(before, after) {
  if (classifyVersion(before) !== 'stable') {
    throw new Error(`npm "latest" is ${before}, not a stable version`);
  }
  if (after !== undefined && after !== before) {
    throw new Error(`npm "latest" moved from ${before} to ${after}`);
  }
}
