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
