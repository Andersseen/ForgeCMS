import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requiresChangeset } from './changeset-check.mjs';

describe('requiresChangeset', () => {
  it('requires a changeset for package files', () => {
    assert.equal(requiresChangeset(['packages/core/src/index.ts']), true);
  });

  it('does not require a changeset for apps, docs, or repository config', () => {
    assert.equal(
      requiresChangeset(['apps/www/src/app.ts', 'docs/STATE.md', '.github/workflows/ci.yml']),
      false
    );
  });
});
