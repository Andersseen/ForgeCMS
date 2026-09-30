import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideAggregateRelease,
  isAlreadyPublishedError,
  releaseCommit
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
