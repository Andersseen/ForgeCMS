import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  PUBLIC_FAMILY,
  assertPostSnapshot,
  classifyPostObservation,
  snapshotFromBaseline,
  verifyPostWithRetry,
  assertFixedFamily,
  assertLatestSafe,
  changesetsCoveredByPrerelease,
  classifyVersion,
  detectReleaseMode,
  githubReleasePlan,
  isRcVersion,
  resolvePublishTag
} from './release-decision.mjs';

const family = (version, names = PUBLIC_FAMILY) => names.map((name) => ({ name, version }));

describe('classifyVersion / detectReleaseMode (spec 092)', () => {
  it('classifies stable and prerelease versions', () => {
    assert.equal(classifyVersion('0.13.4'), 'stable');
    assert.equal(classifyVersion('1.0.0-rc.0'), 'prerelease');
    assert.equal(detectReleaseMode(family('0.13.4')), 'stable');
    assert.equal(detectReleaseMode(family('1.0.0-rc.2')), 'prerelease');
    assert.equal(detectReleaseMode([]), 'none');
  });

  it('rejects unclassifiable versions and mixed families', () => {
    assert.throws(() => classifyVersion('1.0'));
    assert.throws(() => classifyVersion('1.0.0+build'));
    assert.throws(() => classifyVersion(undefined));
    assert.throws(() =>
      detectReleaseMode([
        { name: '@forge-cms/core', version: '0.13.4' },
        { name: '@forge-cms/db', version: '1.0.0-rc.0' }
      ])
    );
  });

  it('recognises only 1.0.0-rc.N as an RC', () => {
    assert.equal(isRcVersion('1.0.0-rc.3'), true);
    assert.equal(isRcVersion('1.0.0'), false);
    assert.equal(isRcVersion('1.0.0-beta.1'), false);
    assert.equal(isRcVersion('1.0.1-rc.0'), false);
  });
});

describe('resolvePublishTag: `latest` cannot be reached by a prerelease', () => {
  it('stable keeps the default (no tag)', () => {
    assert.equal(resolvePublishTag('0.13.4', undefined), null);
  });
  it('stable refuses a custom tag', () => {
    assert.throws(() => resolvePublishTag('0.13.4', 'rc'));
  });
  it('prerelease without a tag fails closed', () => {
    assert.throws(() => resolvePublishTag('1.0.0-rc.0', undefined), /explicit --tag/);
  });
  it('prerelease with --tag latest is rejected', () => {
    assert.throws(() => resolvePublishTag('1.0.0-rc.0', 'latest'), /never publish under/);
  });
  it('prerelease with rc is accepted; malformed tags are rejected', () => {
    assert.equal(resolvePublishTag('1.0.0-rc.0', 'rc'), 'rc');
    for (const bad of ['', 'Latest', '-x', '1.0', 'a b']) {
      assert.throws(() => resolvePublishTag('1.0.0-rc.0', bad), /Invalid npm dist-tag/);
    }
  });
});

describe('assertFixedFamily / assertLatestSafe / githubReleasePlan', () => {
  it('accepts exactly the twelve at one version', () => {
    assert.equal(assertFixedFamily(family('1.0.0-rc.0')), '1.0.0-rc.0');
  });
  it('rejects a missing, extra or split package', () => {
    assert.throws(() => assertFixedFamily(family('1.0.0-rc.0', PUBLIC_FAMILY.slice(1))));
    assert.throws(() =>
      assertFixedFamily(family('1.0.0-rc.0', [...PUBLIC_FAMILY, '@forge-cms/x']))
    );
    const split = family('1.0.0-rc.0');
    split[0].version = '0.13.4';
    assert.throws(() => assertFixedFamily(split));
  });
  it('latest must stay stable and unchanged', () => {
    assert.doesNotThrow(() => assertLatestSafe('0.13.4', '0.13.4'));
    assert.throws(() => assertLatestSafe('1.0.0-rc.0'));
    assert.throws(() => assertLatestSafe('0.13.4', '1.0.0-rc.0'));
  });
  it('GitHub release: stable is not a prerelease, an RC is', () => {
    assert.deepEqual(githubReleasePlan('0.13.4'), { tagName: 'v0.13.4', prerelease: false });
    assert.deepEqual(githubReleasePlan('1.0.0-rc.0'), { tagName: 'v1.0.0-rc.0', prerelease: true });
  });
});

/** Runs publish-unpublished.mjs in a sandbox with fake `npm`/`pnpm` that log their argv. */
function runPublish(version, args, { published = false, publishedNames = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-publish-'));
  const log = join(dir, 'calls.log');
  for (const name of PUBLIC_FAMILY) {
    const pkgDir = join(dir, 'packages', name.split('/')[1]);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name, version }));
  }
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const fake = (tool, body) => {
    writeFileSync(join(bin, tool), `#!/bin/sh\necho "${tool} $@" >> "${log}"\n${body}\n`);
    chmodSync(join(bin, tool), 0o755);
  };
  const partial = publishedNames.map((name) => `${name}@${version}`).join('|');
  fake(
    'npm',
    published
      ? 'echo ok; exit 0'
      : partial
        ? `case "$2" in ${partial}) echo ok; exit 0;; esac; echo "E404 Not Found" >&2; exit 1`
        : 'echo "E404 Not Found" >&2; exit 1'
  );
  fake('pnpm', 'exit 0');
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/publish-unpublished.mjs'), ...args],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }
  );
  return { result, calls: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

describe('publish-unpublished.mjs (spawned with fake npm/pnpm)', () => {
  it('stable: publishes without any --tag (behaviour unchanged)', () => {
    const { result, calls } = runPublish('0.13.4', []);
    assert.equal(result.status, 0, result.stderr);
    const publishes = calls.split('\n').filter((line) => line.startsWith('pnpm'));
    assert.equal(publishes.length, 12);
    assert.ok(publishes.every((line) => !line.includes('--tag') && line.includes('--provenance')));
  });

  it('prerelease without --tag fails before any registry call', () => {
    const { result, calls } = runPublish('1.0.0-rc.0', []);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /explicit --tag/);
    assert.equal(calls, '');
  });

  it('prerelease with --tag latest fails before any registry call', () => {
    const { result, calls } = runPublish('1.0.0-rc.0', ['--tag', 'latest']);
    assert.notEqual(result.status, 0);
    assert.equal(calls, '');
  });

  it('a bare --tag fails', () => {
    const { result } = runPublish('1.0.0-rc.0', ['--tag']);
    assert.notEqual(result.status, 0);
  });

  it('stable with --tag rc fails', () => {
    const { result, calls } = runPublish('0.13.4', ['--tag', 'rc']);
    assert.notEqual(result.status, 0);
    assert.equal(calls, '');
  });

  it('prerelease with --tag rc publishes every package with --tag rc and provenance', () => {
    const { result, calls } = runPublish('1.0.0-rc.0', ['--tag', 'rc']);
    assert.equal(result.status, 0, result.stderr);
    const publishes = calls.split('\n').filter((line) => line.startsWith('pnpm'));
    assert.equal(publishes.length, 12);
    assert.ok(
      publishes.every((line) => line.includes('--tag rc') && line.includes('--provenance'))
    );
  });

  it('is resumable: already-published packages are skipped, never re-published', () => {
    const { result, calls } = runPublish('1.0.0-rc.0', ['--tag', 'rc'], { published: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(calls.split('\n').filter((line) => line.startsWith('pnpm')).length, 0);
    assert.match(result.stdout, /already published/);
  });
});

describe('publish-unpublished.mjs resumes a partial candidate publication (spec 095)', () => {
  it('publishes only the packages whose candidate version is missing', () => {
    const done = ['@forge-cms/core', '@forge-cms/agent'];
    const { result, calls } = runPublish('1.0.0-rc.1', ['--tag', 'rc'], { publishedNames: done });
    assert.equal(result.status, 0, result.stderr);
    const publishes = calls.split('\n').filter((line) => line.startsWith('pnpm'));
    assert.equal(publishes.length, 10);
    assert.ok(
      publishes.every((line) => line.includes('--tag rc') && line.includes('--provenance'))
    );
    for (const name of done) assert.ok(!publishes.some((line) => line.includes(name)));
    assert.ok(!calls.includes('dist-tag'), 'never moves a dist-tag');
  });
});

describe('changesetsCoveredByPrerelease (CI changeset check in pre mode)', () => {
  it('accepts added changesets that the prerelease version commit consumed', () => {
    const verdict = changesetsCoveredByPrerelease({
      added: ['.changeset/a.md', '.changeset/b.md'],
      preChangesets: ['a', 'b', 'older']
    });
    assert.equal(verdict.ok, true);
  });
  it('rejects outside pre mode, with no added changeset, or with an unrecorded one', () => {
    assert.equal(
      changesetsCoveredByPrerelease({ added: ['.changeset/a.md'], preChangesets: null }).ok,
      false
    );
    assert.equal(changesetsCoveredByPrerelease({ added: [], preChangesets: ['a'] }).ok, false);
    assert.equal(
      changesetsCoveredByPrerelease({ added: ['.changeset/README.md'], preChangesets: ['a'] }).ok,
      false
    );
    assert.equal(
      changesetsCoveredByPrerelease({
        added: ['.changeset/a.md', '.changeset/new.md'],
        preChangesets: ['a']
      }).ok,
      false
    );
  });
});

describe('POST verification waits out registry propagation (workflow 38883295228)', () => {
  const V = '1.0.0-rc.2';
  const snapshot = snapshotFromBaseline('0.13.4', ['@forge-cms/agent']);
  /** Fully propagated registry: rc → V everywhere, latest untouched (agent has none). */
  const settled = () =>
    Object.fromEntries(
      PUBLIC_FAMILY.map((name) => [
        name,
        {
          exists: true,
          tags: name === '@forge-cms/agent' ? { rc: V } : { latest: '0.13.4', rc: V }
        }
      ])
    );
  const clock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms) => void (t += ms) };
  };

  it('snapshotFromBaseline marks first-published packages absent without latest', () => {
    assert.deepEqual(snapshot.packages['@forge-cms/agent'], { exists: false, latest: null });
    assert.deepEqual(snapshot.packages['@forge-cms/core'], { exists: true, latest: '0.13.4' });
    assert.throws(() => snapshotFromBaseline('1.0.0-rc.1', []), /not a stable/);
    assert.throws(() => snapshotFromBaseline('0.13.4', ['@forge-cms/nope']), /fixed family/);
  });

  it('eventual success: a package invisible for several reads is retried, not failed', async () => {
    let reads = 0;
    const { now, sleep } = clock();
    const logs = [];
    const { attempts } = await verifyPostWithRetry({
      snapshot,
      version: V,
      observe: () => {
        reads += 1;
        const observed = settled();
        if (reads < 4) observed['@forge-cms/core'] = { exists: false, tags: null };
        return observed;
      },
      sleep,
      now,
      timeoutMs: 20 * 60_000,
      intervalMs: 30_000,
      log: (m) => logs.push(m)
    });
    assert.equal(attempts, 4);
    assert.ok(logs.some((m) => m.includes('@forge-cms/core: not found in the registry yet')));
  });

  it('an rc tag that is not visible yet is pending; once visible it passes', async () => {
    let reads = 0;
    const { now, sleep } = clock();
    await verifyPostWithRetry({
      snapshot,
      version: V,
      observe: () => {
        const observed = settled();
        if (++reads < 3) observed['@forge-cms/db'].tags = { latest: '0.13.4' };
        return observed;
      },
      sleep,
      now,
      timeoutMs: 600_000,
      intervalMs: 30_000
    });
    assert.equal(reads, 3);
  });

  it('permanent failure: still missing at the deadline fails, naming the package, and does not spin', async () => {
    let reads = 0;
    const { now, sleep } = clock();
    await assert.rejects(
      verifyPostWithRetry({
        snapshot,
        version: V,
        observe: () => {
          reads += 1;
          const observed = settled();
          observed['@forge-cms/core'] = { exists: true, tags: { latest: '0.13.4' } };
          return observed;
        },
        sleep,
        now,
        timeoutMs: 120_000,
        intervalMs: 30_000
      }),
      /incomplete after 120s: @forge-cms\/core: "rc" tag not visible yet/
    );
    assert.equal(reads, 5);
  });

  it('proven violations fail at once, without waiting', async () => {
    for (const mutate of [
      (o) => (o['@forge-cms/core'].tags.rc = '1.0.0-rc.1'),
      (o) => (o['@forge-cms/core'].tags.latest = V),
      (o) => (o['@forge-cms/core'].tags.latest = '0.13.5'),
      (o) => delete o['@forge-cms/core'].tags.latest
    ]) {
      let reads = 0;
      const { now, sleep } = clock();
      await assert.rejects(
        verifyPostWithRetry({
          snapshot,
          version: V,
          observe: () => {
            reads += 1;
            const observed = settled();
            mutate(observed);
            return observed;
          },
          sleep,
          now,
          timeoutMs: 600_000,
          intervalMs: 30_000
        }),
        /@forge-cms\/core: (npm "latest" moved|"rc" is)/
      );
      assert.equal(reads, 1);
    }
  });

  it('a registry error (auth, network, malformed) propagates and is never retried', async () => {
    let reads = 0;
    const { now, sleep } = clock();
    await assert.rejects(
      verifyPostWithRetry({
        snapshot,
        version: V,
        observe: () => {
          reads += 1;
          throw new Error('npm view @forge-cms/core dist-tags failed\nE401');
        },
        sleep,
        now,
        timeoutMs: 600_000,
        intervalMs: 30_000
      }),
      /E401/
    );
    assert.equal(reads, 1);
  });

  it("a first publication keeps no latest: npm's auto-assigned latest is a violation unless repair is enabled", () => {
    const observed = settled();
    observed['@forge-cms/agent'].tags = { latest: V, rc: V };
    assert.deepEqual(classifyPostObservation(snapshot, V, observed).violations, [
      `@forge-cms/agent: npm "latest" moved from null to ${V}`
    ]);
    assert.throws(() => assertPostSnapshot(snapshot, V, observed), /@forge-cms\/agent/);
    const repair = classifyPostObservation(snapshot, V, observed, {
      allowFirstPublicationLatest: true
    });
    assert.deepEqual(repair.repairs, ['@forge-cms/agent']);
    assert.deepEqual(repair.violations, []);
  });

  it('repair removes only the first-publication latest, then verifies the re-read', async () => {
    const observed = settled();
    observed['@forge-cms/agent'].tags = { latest: V, rc: V };
    const removed = [];
    const { now, sleep } = clock();
    await verifyPostWithRetry({
      snapshot,
      version: V,
      observe: () => structuredClone(observed),
      removeLatest: (name) => {
        removed.push(name);
        delete observed[name].tags.latest;
      },
      allowFirstPublicationLatest: true,
      sleep,
      now,
      timeoutMs: 600_000,
      intervalMs: 30_000
    });
    assert.deepEqual(removed, ['@forge-cms/agent']);
  });

  it('repair never touches a package that already had a stable latest', async () => {
    const observed = settled();
    observed['@forge-cms/core'].tags.latest = V;
    const { now, sleep } = clock();
    await assert.rejects(
      verifyPostWithRetry({
        snapshot,
        version: V,
        observe: () => structuredClone(observed),
        removeLatest: () => assert.fail('must not remove latest'),
        allowFirstPublicationLatest: true,
        sleep,
        now,
        timeoutMs: 600_000,
        intervalMs: 30_000
      }),
      /@forge-cms\/core: npm "latest" moved from 0.13.4/
    );
  });

  it('a repair that does not take effect fails at the deadline instead of looping', async () => {
    const observed = settled();
    observed['@forge-cms/agent'].tags = { latest: V, rc: V };
    const { now, sleep } = clock();
    await assert.rejects(
      verifyPostWithRetry({
        snapshot,
        version: V,
        observe: () => structuredClone(observed),
        removeLatest: () => {},
        allowFirstPublicationLatest: true,
        sleep,
        now,
        timeoutMs: 90_000,
        intervalMs: 30_000
      }),
      /did not take effect/
    );
  });
});
