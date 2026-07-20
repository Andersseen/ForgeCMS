import { describe, expect, it } from 'vitest';
import {
  CmsApiService,
  FORGE_CMS_CONFIG,
  USER_ROLES,
  canManageUsers,
  canWriteContent,
  isAdmin,
  userRole
} from './index';
import type { AuthUser } from './index';

describe('@forge-cms/angular', () => {
  it('exports CmsApiService', () => {
    expect(CmsApiService).toBeDefined();
  });

  it('exports FORGE_CMS_CONFIG token', () => {
    expect(FORGE_CMS_CONFIG).toBeDefined();
  });

  describe('role helpers', () => {
    const admin: AuthUser = { id: '1', role: 'admin' };
    const editor: AuthUser = { id: '2', role: 'editor' };
    const viewer: AuthUser = { id: '3', role: 'viewer' };

    it('exports the canonical role list', () => {
      expect(USER_ROLES).toEqual(['admin', 'editor', 'viewer']);
    });

    it('normalizes role values', () => {
      expect(userRole(admin)).toBe('admin');
      expect(userRole(editor)).toBe('editor');
      expect(userRole(viewer)).toBe('viewer');
      expect(userRole(null)).toBe('viewer');
    });

    it('identifies admins', () => {
      expect(isAdmin(admin)).toBe(true);
      expect(isAdmin(editor)).toBe(false);
      expect(isAdmin(viewer)).toBe(false);
    });

    it('identifies content writers', () => {
      expect(canWriteContent(admin)).toBe(true);
      expect(canWriteContent(editor)).toBe(true);
      expect(canWriteContent(viewer)).toBe(false);
    });

    it('identifies user managers', () => {
      expect(canManageUsers(admin)).toBe(true);
      expect(canManageUsers(editor)).toBe(false);
      expect(canManageUsers(viewer)).toBe(false);
    });
  });
});
