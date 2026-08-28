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
});
