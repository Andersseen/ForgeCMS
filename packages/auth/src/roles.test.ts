import { describe, expect, it } from 'vitest';
import type { AuthUser } from './index.js';
import {
  USER_ROLES,
  userRole,
  hasRole,
  hasAnyRole,
  isAdmin,
  canWriteContent,
  canManageUsers
} from './roles.js';

describe('role helpers', () => {
  const admin: AuthUser = { id: '1', role: 'admin' };
  const editor: AuthUser = { id: '2', role: 'editor' };
  const viewer: AuthUser = { id: '3', role: 'viewer' };
  const noRole: AuthUser = { id: '4' };

  it('exports the expected role list', () => {
    expect(USER_ROLES).toEqual(['admin', 'editor', 'viewer']);
  });

  it('normalizes user role', () => {
    expect(userRole(admin)).toBe('admin');
    expect(userRole(editor)).toBe('editor');
    expect(userRole(viewer)).toBe('viewer');
    expect(userRole(noRole)).toBe('viewer');
    expect(userRole(null)).toBe('viewer');
    expect(userRole(undefined)).toBe('viewer');
  });

  it('checks a single role', () => {
    expect(hasRole(admin, 'admin')).toBe(true);
    expect(hasRole(editor, 'admin')).toBe(false);
    expect(hasRole(viewer, 'viewer')).toBe(true);
    expect(hasRole(noRole, 'viewer')).toBe(true);
  });

  it('checks any role in a list', () => {
    expect(hasAnyRole(admin, ['admin', 'editor'])).toBe(true);
    expect(hasAnyRole(editor, ['admin', 'editor'])).toBe(true);
    expect(hasAnyRole(viewer, ['admin', 'editor'])).toBe(false);
    expect(hasAnyRole(noRole, ['admin', 'editor'])).toBe(false);
  });

  it('identifies admins', () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(editor)).toBe(false);
    expect(isAdmin(viewer)).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });

  it('identifies content writers', () => {
    expect(canWriteContent(admin)).toBe(true);
    expect(canWriteContent(editor)).toBe(true);
    expect(canWriteContent(viewer)).toBe(false);
    expect(canWriteContent(null)).toBe(false);
  });

  it('identifies user managers', () => {
    expect(canManageUsers(admin)).toBe(true);
    expect(canManageUsers(editor)).toBe(false);
    expect(canManageUsers(viewer)).toBe(false);
    expect(canManageUsers(null)).toBe(false);
  });
});
