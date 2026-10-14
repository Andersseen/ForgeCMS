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
  assertFixedFamily,
  assertLatestSafe,
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
  it('accepts exactly the eleven at one version', () => {
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
function runPublish(version, args, { published = false } = {}) {
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
  fake('npm', published ? 'echo ok; exit 0' : 'echo "E404 Not Found" >&2; exit 1');
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
    assert.equal(publishes.length, 11);
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
    assert.equal(publishes.length, 11);
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
