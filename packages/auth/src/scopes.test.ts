import { describe, expect, it } from 'vitest';
import { hasScope, hasAnyScope, hasAllScopes } from './scopes.js';
import type { AuthUser } from './index.js';

const machine: AuthUser = {
  id: 'key-1',
  role: 'machine',
  scopes: ['articles:read', 'articles:write']
};
const noScopes: AuthUser = { id: 'key-2', role: 'machine' };

describe('scope helpers', () => {
  it('hasScope is true when the scope is present', () => {
    expect(hasScope(machine, 'articles:read')).toBe(true);
  });

  it('hasScope is false when the scope is absent', () => {
    expect(hasScope(machine, 'articles:delete')).toBe(false);
  });

  it('hasScope handles a user with no scopes array', () => {
    expect(hasScope(noScopes, 'articles:read')).toBe(false);
  });

  it('hasScope handles null/undefined users', () => {
    expect(hasScope(null, 'articles:read')).toBe(false);
    expect(hasScope(undefined, 'articles:read')).toBe(false);
  });

  it('hasAnyScope is true if at least one scope matches', () => {
    expect(hasAnyScope(machine, ['articles:delete', 'articles:read'])).toBe(true);
  });

  it('hasAnyScope is false if none match', () => {
    expect(hasAnyScope(machine, ['articles:delete', 'users:read'])).toBe(false);
  });

  it('hasAllScopes is true only if every scope matches', () => {
    expect(hasAllScopes(machine, ['articles:read', 'articles:write'])).toBe(true);
    expect(hasAllScopes(machine, ['articles:read', 'articles:delete'])).toBe(false);
  });

  describe('documented empty-array semantics', () => {
    it('hasAnyScope([]) is always false — nothing in an empty list can match', () => {
      expect(hasAnyScope(machine, [])).toBe(false);
      expect(hasAnyScope(null, [])).toBe(false);
      expect(hasAnyScope(undefined, [])).toBe(false);
    });

    it('hasAllScopes([]) is always true — vacuously, "all of zero required scopes"', () => {
      expect(hasAllScopes(machine, [])).toBe(true);
      expect(hasAllScopes(noScopes, [])).toBe(true);
      expect(hasAllScopes(null, [])).toBe(true);
      expect(hasAllScopes(undefined, [])).toBe(true);
    });
  });

  it('duplicate scopes on the user do not change the result either way', () => {
    const withDuplicates: AuthUser = {
      id: 'key-3',
      role: 'machine',
      scopes: ['articles:read', 'articles:read', 'articles:write']
    };
    expect(hasScope(withDuplicates, 'articles:read')).toBe(true);
    expect(hasAllScopes(withDuplicates, ['articles:read', 'articles:write'])).toBe(true);
    expect(hasAnyScope(withDuplicates, ['articles:delete'])).toBe(false);
  });

  it('a human user (no role of "machine") is checked identically — scopes are role-agnostic', () => {
    const human: AuthUser = { id: 'user-1', role: 'editor', scopes: ['articles:read'] };
    expect(hasScope(human, 'articles:read')).toBe(true);
    expect(hasScope(human, 'articles:write')).toBe(false);
  });
});
