import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decideAggregateRelease,
  assertTagTarget,
  isAlreadyPublishedError,
  releaseCommit,
  releaseTargetSha
} from './release-decision.mjs';

const family = (version) => [
  { name: '@forge-cms/core', version },
  { name: '@forge-cms/db', version }
];

describe('decideAggregateRelease (spec 072 §9)', () => {
  it('the Version Packages merge that bumps the family creates the release', () => {
    assert.deepEqual(decideAggregateRelease({ head: family('0.8.1'), base: family('0.8.0') }), {
      create: true,
      version: '0.8.1',
      reason: 'this commit introduces 0.8.1'
    });
  });

  it('a later ordinary main push with the same version does not tag (the v0.7.0 bug)', () => {
    const decision = decideAggregateRelease({ head: family('0.7.0'), base: family('0.7.0') });
    assert.equal(decision.create, false);
    assert.equal(decision.version, '0.7.0');
  });

  it('an unreadable first parent never tags', () => {
    assert.equal(decideAggregateRelease({ head: family('0.8.1'), base: null }).create, false);
  });

  it('a newly added public package counts as a transition', () => {
    const base = [{ name: '@forge-cms/core', version: '0.8.0' }];
    assert.equal(decideAggregateRelease({ head: family('0.8.1'), base }).create, true);
  });

  it('refuses a split family', () => {
    assert.throws(() =>
      decideAggregateRelease({
        head: [
          { name: '@forge-cms/core', version: '0.8.1' },
          { name: '@forge-cms/db', version: '0.8.0' }
        ],
        base: family('0.8.0')
      })
    );
  });
});

describe('isAlreadyPublishedError', () => {
  it('recognises the registry-lag conflict that failed the 0.7.0 run', () => {
    assert.equal(
      isAlreadyPublishedError(
        'npm error code E409\nnpm error 409 Conflict - PUT https://registry.npmjs.org/@forge-cms%2fadmin - Cannot publish over previously staged version "0.7.0".'
      ),
      true
    );
  });

  it('recognises the classic E403', () => {
    assert.equal(
      isAlreadyPublishedError(
        'npm ERR! code E403\nnpm ERR! 403 Forbidden - You cannot publish over the previously published versions: 0.7.0.'
      ),
      true
    );
  });

  it('does not swallow other failures', () => {
    assert.equal(isAlreadyPublishedError('npm error code E401\nUnable to authenticate'), false);
    assert.equal(isAlreadyPublishedError('npm error code E409\nConflict'), false);
  });
});

describe('releaseCommit (spec 073)', () => {
  it('decides for the triggering commit, not for HEAD left on changeset-release/main', () => {
    assert.equal(
      releaseCommit({ GITHUB_SHA: 'f4c22a9c32808186e374dccb705eb3a20b05cd1e' }),
      'f4c22a9c32808186e374dccb705eb3a20b05cd1e'
    );
  });

  it('falls back to HEAD outside CI', () => {
    assert.equal(releaseCommit({}), 'HEAD');
    assert.equal(releaseCommit({ GITHUB_SHA: '  ' }), 'HEAD');
  });
});

describe('releaseTargetSha (L01 finalize: tag the original publication commit)', () => {
  const original = '6563c94cdaafa4d842cbe6dbd96c4269a74046d4';
  const tooling = 'f5b5a539c60fffd31d761a7455ef742b2869ddbf';

  it('prefers RELEASE_TARGET_SHA over the runner-reserved GITHUB_SHA', () => {
    assert.equal(releaseTargetSha({ RELEASE_TARGET_SHA: original, GITHUB_SHA: tooling }), original);
  });

  it('falls back to GITHUB_SHA, or nothing', () => {
    assert.equal(releaseTargetSha({ GITHUB_SHA: tooling }), tooling);
    assert.equal(releaseTargetSha({ RELEASE_TARGET_SHA: ' ' }), undefined);
  });

  it('refuses a missing or invalid candidate SHA', () => {
    for (const bad of ['6563c94', 'main', original.toUpperCase(), `${original}0`]) {
      assert.throws(() => releaseTargetSha({ RELEASE_TARGET_SHA: bad }), /40-character/);
    }
  });

  it('an existing release whose tag points elsewhere is refused, not treated as done', () => {
    assert.doesNotThrow(() => assertTagTarget('v1.0.0-rc.2', original, original));
    assert.throws(() => assertTagTarget('v1.0.0-rc.2', tooling, original), /points at f5b5a53/);
    assert.throws(() => assertTagTarget('v1.0.0-rc.2', undefined, original), /nothing/);
  });
});

describe('release-rc.yml finalize job (static guards)', () => {
  const yml = readFileSync(new URL('../.github/workflows/release-rc.yml', import.meta.url), 'utf8');
  const finalize = yml.slice(yml.indexOf('  finalize-rc:'));

  it('only runs in finalize mode and never publishes or mutates tags', () => {
    assert.match(finalize, /if: inputs\.mode == 'finalize'/);
    assert.doesNotMatch(finalize, /npm publish|release:publish-unpublished|dist-tag|pnpm publish/);
    assert.match(finalize, /--phase finalize/);
    assert.match(finalize, /--baseline/);
  });

  it('tags the original candidate SHA, not the dispatched tooling ref', () => {
    assert.match(finalize, /RELEASE_TARGET_SHA: \$\{\{ inputs\.sha \}\}/);
    assert.doesNotMatch(finalize, /^\s+GITHUB_SHA:/m);
  });

  it('creates the prerelease only after the verification step', () => {
    assert.ok(finalize.indexOf('--phase finalize') < finalize.indexOf('create-github-release.mjs'));
  });
});
