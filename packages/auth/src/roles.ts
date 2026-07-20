import type { AuthUser } from './index.js';

export type UserRole = 'admin' | 'editor' | 'viewer';

export const USER_ROLES: UserRole[] = ['admin', 'editor', 'viewer'];

export function userRole(user: AuthUser | null | undefined): UserRole {
  const role = user?.role;
  if (role === 'admin' || role === 'editor' || role === 'viewer') return role;
  return 'viewer';
}

export function hasRole(user: AuthUser | null | undefined, role: UserRole): boolean {
  return userRole(user) === role;
}

export function hasAnyRole(user: AuthUser | null | undefined, roles: UserRole[]): boolean {
  return roles.includes(userRole(user));
}

export function isAdmin(user: AuthUser | null | undefined): boolean {
  return hasRole(user, 'admin');
}

export function canWriteContent(user: AuthUser | null | undefined): boolean {
  return hasAnyRole(user, ['admin', 'editor']);
}

export function canManageUsers(user: AuthUser | null | undefined): boolean {
  return isAdmin(user);
}
