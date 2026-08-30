import type { AuthUser } from './index.js';

/**
 * Whether `user` carries the given generic scope string (e.g. `'articles:read'`).
 *
 * `undefined`/`null` user, or a user with no `scopes` at all (a human principal, typically), is
 * treated as carrying zero scopes — always `false` for any non-empty `scope`. Duplicate entries in
 * `user.scopes` (normalized away at write time by `ApiKeyAuthAdapter.createApiKey`, but not
 * re-validated here for a hand-built `AuthUser`) do not affect the result either way.
 */
export function hasScope(user: AuthUser | null | undefined, scope: string): boolean {
  return (user?.scopes ?? []).includes(scope);
}

/**
 * Whether `user` carries at least one of the given scopes. `hasAnyScope(user, [])` is always `false`
 * — there is nothing in an empty list to match — matching `Array.prototype.some`'s own empty-array
 * behavior.
 */
export function hasAnyScope(user: AuthUser | null | undefined, scopes: string[]): boolean {
  return scopes.some((scope) => hasScope(user, scope));
}

/**
 * Whether `user` carries every one of the given scopes. `hasAllScopes(user, [])` is always `true` —
 * vacuously, a user satisfies "all of zero required scopes" regardless of who `user` is, including
 * `null`/`undefined`. This mirrors `Array.prototype.every`'s own empty-array behavior and the common
 * access-control convention that "no scopes required" means "no additional restriction" — it is not
 * a special case here, just the deliberate, documented result of requiring nothing.
 */
export function hasAllScopes(user: AuthUser | null | undefined, scopes: string[]): boolean {
  return scopes.every((scope) => hasScope(user, scope));
}
