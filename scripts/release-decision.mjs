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

/** The one fixed public package family (`.changeset/config.json` → `fixed`). `@forge-cms/agent` is experimental (spec 093) but versioned with the family. */
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
  '@forge-cms/testing',
  '@forge-cms/agent'
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

/** Whether npm output means "this package does not exist in the registry" (a genuine 404, nothing else). */
export function isRegistryNotFound(output) {
  return /E404|404 Not Found|is not in this registry/.test(String(output));
}

/**
 * Registry state of one package from `npm view <name> dist-tags --json`: `{ exists, latest }`.
 * `latest` is `null` when the package has no `latest` tag (never published stable, or prerelease-only).
 *
 * @param {unknown} tags parsed dist-tags, or `null` for a genuinely absent package
 * @returns {{ exists: boolean, latest: string | null }}
 */
export function registryStateFromDistTags(tags) {
  if (tags === null) return { exists: false, latest: null };
  if (typeof tags !== 'object' || Array.isArray(tags)) {
    throw new Error(`Malformed dist-tags response: ${JSON.stringify(tags)}`);
  }
  const latest = /** @type {Record<string, unknown>} */ (tags).latest;
  if (latest === undefined) return { exists: true, latest: null };
  if (typeof latest !== 'string')
    throw new Error(`Malformed npm "latest": ${JSON.stringify(latest)}`);
  return { exists: true, latest };
}

/**
 * The PRE snapshot of the fixed family's registry state (spec 095). Every existing `latest` must be a
 * stable version and all of them must agree; a package may be absent or prerelease-only (no `latest`),
 * but at least one package must establish the stable baseline.
 *
 * @param {Record<string, { exists: boolean, latest: string | null }>} states by package name
 * @returns {{ stableBaseline: string, packages: Record<string, { exists: boolean, latest: string | null }> }}
 */
export function buildPreSnapshot(states) {
  const names = Object.keys(states).sort();
  if (names.join() !== [...PUBLIC_FAMILY].sort().join()) {
    throw new Error(`Registry states do not cover exactly the fixed family: ${names}`);
  }
  const packages = {};
  const baselines = new Set();
  for (const name of names) {
    const state = states[name];
    if (!state.exists && state.latest !== null)
      throw new Error(`${name}: absent package has a latest`);
    if (state.latest !== null) {
      assertLatestSafe(state.latest);
      baselines.add(state.latest);
    }
    packages[name] = { exists: state.exists, latest: state.latest };
  }
  if (baselines.size === 0)
    throw new Error('No package has a stable "latest": no baseline to protect');
  if (baselines.size > 1) {
    throw new Error(`npm "latest" differs across the family: ${[...baselines].join(', ')}`);
  }
  return { stableBaseline: [...baselines][0], packages };
}

/**
 * Classifies one POST observation of the registry against the PRE snapshot, without throwing.
 *
 * - `pending`: transient by nature — npm accepted the publication ("may take a few minutes to become
 *   available") but the version or its `rc` tag is not visible yet (workflow 38883295228: `core` took ~10 min).
 * - `violations`: proven invariant breaks that no amount of waiting repairs — `rc` pointing at another version,
 *   or `latest` differing from the PRE snapshot.
 * - `repairs`: first-publication packages whose `latest` npm auto-assigned to the candidate. npm sets `latest`
 *   on a package's first version whatever `--tag` says; a violation unless `allowFirstPublicationLatest`.
 *
 * @param {{ packages: Record<string, { exists: boolean, latest: string | null }> }} snapshot
 * @param {string} version candidate version
 * @param {Record<string, { exists: boolean, tags: Record<string, string> | null }>} observed
 * - `accepted`: the same state when `acceptFirstPublicationLatest` is set — the registry refuses to remove a
 *   `latest` tag (HTTP 400), so the maintainer may accept it for that package alone (no registry mutation).
 *
 * @param {{ allowFirstPublicationLatest?: boolean, acceptFirstPublicationLatest?: boolean }} [options]
 * @returns {{ pending: string[], violations: string[], repairs: string[], accepted: string[] }}
 */
export function classifyPostObservation(snapshot, version, observed, options = {}) {
  const pending = [];
  const violations = [];
  const repairs = [];
  const accepted = [];
  for (const name of PUBLIC_FAMILY) {
    const before = snapshot.packages?.[name];
    if (!before) {
      violations.push(`${name}: missing from the PRE snapshot`);
      continue;
    }
    const now = observed[name];
    if (!now?.exists || !now.tags) {
      pending.push(`${name}: not found in the registry yet`);
      continue;
    }
    const latest = now.tags.latest ?? null;
    if (latest !== before.latest) {
      const firstPublicationLatest = !before.exists && before.latest === null && latest === version;
      if (options.allowFirstPublicationLatest && firstPublicationLatest) {
        repairs.push(name);
      } else if (options.acceptFirstPublicationLatest && firstPublicationLatest) {
        accepted.push(name);
      } else {
        violations.push(`${name}: npm "latest" moved from ${before.latest} to ${latest}`);
      }
    }
    const rc = now.tags[RC_TAG];
    if (rc === undefined) pending.push(`${name}: "${RC_TAG}" tag not visible yet`);
    else if (rc !== version) violations.push(`${name}: "${RC_TAG}" is ${rc}, expected ${version}`);
  }
  return { pending, violations, repairs, accepted };
}

/**
 * Strict single-shot POST check: any pending, violated or repairable state throws.
 *
 * @param {Parameters<typeof classifyPostObservation>[0]} snapshot
 * @param {string} version
 * @param {Parameters<typeof classifyPostObservation>[2]} observed
 */
export function assertPostSnapshot(snapshot, version, observed) {
  const { pending, violations, repairs } = classifyPostObservation(snapshot, version, observed);
  const problems = [
    ...violations,
    ...pending,
    ...repairs.map((name) => `${name}: npm "latest" moved from null to ${version}`)
  ];
  if (problems.length > 0) throw new Error(problems[0]);
}

/**
 * POST verification with a bounded wait for registry propagation. Only `pending` observations are retried,
 * until `timeoutMs`; a violation fails at once and a package still pending at the deadline fails too. When
 * `allowFirstPublicationLatest` is set, `latest` tags npm auto-assigned to a first-published candidate are
 * removed through `removeLatest` (and re-observed), never any other tag.
 *
 * @param {object} input
 * @param {{ packages: Record<string, { exists: boolean, latest: string | null }> }} input.snapshot
 * @param {string} input.version
 * @param {() => Promise<Record<string, { exists: boolean, tags: Record<string, string> | null }>> | Record<string, { exists: boolean, tags: Record<string, string> | null }>} input.observe fresh registry read; throws on auth/network/malformed responses (never retried)
 * @param {(ms: number) => Promise<void>} input.sleep
 * @param {() => number} input.now
 * @param {number} input.timeoutMs
 * @param {number} input.intervalMs
 * @param {boolean} [input.allowFirstPublicationLatest]
 * @param {boolean} [input.acceptFirstPublicationLatest] tolerate (never remove) a first-publication `latest`
 * @param {(name: string) => Promise<void> | void} [input.removeLatest]
 * @param {(message: string) => void} [input.log]
 */
export async function verifyPostWithRetry(input) {
  const { snapshot, version, observe, sleep, now, timeoutMs, intervalMs } = input;
  const log = input.log ?? (() => {});
  const deadline = now() + timeoutMs;
  for (let attempt = 1; ; attempt++) {
    const observed = await observe();
    const { pending, violations, repairs } = classifyPostObservation(snapshot, version, observed, {
      allowFirstPublicationLatest: input.allowFirstPublicationLatest ?? false,
      acceptFirstPublicationLatest: input.acceptFirstPublicationLatest ?? false
    });
    if (violations.length > 0) throw new Error(violations.join('; '));
    for (const name of repairs) {
      if (!input.removeLatest) throw new Error(`${name}: no latest-removal handler configured`);
      log(`${name}: removing the "latest" tag npm auto-assigned to its first version ${version}`);
      await input.removeLatest(name);
    }
    if (pending.length === 0 && repairs.length === 0) return { attempts: attempt };
    if (now() >= deadline) {
      throw new Error(
        `Registry still incomplete after ${Math.round(timeoutMs / 1000)}s: ${pending.join('; ') || 'a latest-tag repair did not take effect'}`
      );
    }
    log(`attempt ${attempt}: ${pending.length ? pending.join('; ') : 'rechecking after repair'}`);
    await sleep(intervalMs);
  }
}

/**
 * Reconstructs the PRE snapshot of an earlier run whose snapshot file is gone (finalize mode): the stable
 * baseline every pre-existing package had, and the packages that were first-published by that run.
 *
 * @param {string} baseline stable `latest` (e.g. `0.13.4`)
 * @param {string[]} firstPublication packages absent from npm before the run
 */
export function snapshotFromBaseline(baseline, firstPublication) {
  assertLatestSafe(baseline);
  const unknown = firstPublication.filter((name) => !PUBLIC_FAMILY.includes(name));
  if (unknown.length > 0) throw new Error(`Not in the fixed family: ${unknown.join(', ')}`);
  const packages = {};
  for (const name of PUBLIC_FAMILY) {
    packages[name] = firstPublication.includes(name)
      ? { exists: false, latest: null }
      : { exists: true, latest: baseline };
  }
  return { stableBaseline: baseline, packages };
}

/**
 * `changeset status` ignores changesets that a prerelease version commit already consumed (they are listed in
 * `.changeset/pre.json`). A pull request that both changes packages and contains the Changesets prerelease
 * version commit would then look "changeset-less". It is covered when the PR adds at least one changeset file
 * and every added changeset file is recorded in `pre.json` (spec 092/093).
 *
 * @param {{ added: string[], preChangesets: string[] | null }} input
 *   `added`: `.changeset/*.md` paths added since the base branch. `preChangesets`: `pre.json` `changesets`, or `null` outside pre mode.
 * @returns {{ ok: boolean, reason: string }}
 */
export function changesetsCoveredByPrerelease({ added, preChangesets }) {
  if (preChangesets === null)
    return { ok: false, reason: 'Changesets prerelease mode is not active' };
  const files = added.filter((path) => /(^|\/)[^/]+\.md$/.test(path) && !/README\.md$/.test(path));
  if (files.length === 0) return { ok: false, reason: 'the pull request adds no changeset file' };
  const recorded = new Set(preChangesets);
  const unrecorded = files.filter(
    (path) => !recorded.has(path.replace(/^.*\//, '').replace(/\.md$/, ''))
  );
  return unrecorded.length === 0
    ? {
        ok: true,
        reason: `${files.length} changeset file(s) added, all consumed by the prerelease version commit`
      }
    : { ok: false, reason: `changeset(s) not recorded in pre.json: ${unrecorded.join(', ')}` };
}
