import type { AuthUser } from './index.js';

/** Whether `user` carries the given generic scope string (e.g. `'articles:read'`). */
export function hasScope(user: AuthUser | null | undefined, scope: string): boolean {
  return (user?.scopes ?? []).includes(scope);
}

/** Whether `user` carries at least one of the given scopes. */
export function hasAnyScope(user: AuthUser | null | undefined, scopes: string[]): boolean {
  return scopes.some((scope) => hasScope(user, scope));
}

/** Whether `user` carries every one of the given scopes. */
export function hasAllScopes(user: AuthUser | null | undefined, scopes: string[]): boolean {
  return scopes.every((scope) => hasScope(user, scope));
}
