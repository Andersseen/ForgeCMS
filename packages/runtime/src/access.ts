import type {
  AccessArgs,
  AccessQuery,
  AccessRule,
  CmsUser,
  CollectionDefinition,
  FieldAccessArgs,
  FieldAccessRule
} from '@forge-cms/core';
import type { DatabaseWhere } from '@forge-cms/db';
import { matchesCondition } from '@forge-cms/db';

/**
 * The outcome of an access check. `allowed: false` denies outright; `allowed: true` with a `where`
 * grants access only to documents matching it (spec 020).
 */
export interface AccessDecision {
  allowed: boolean;
  where?: DatabaseWhere;
}

const DENIED: AccessDecision = { allowed: false };
const ALLOWED: AccessDecision = { allowed: true };

function roleOf(user: CmsUser | null): string | undefined {
  if (!user) return undefined;
  if (typeof user.role === 'string') return user.role;
  return user.roles?.[0];
}

/** `string[]` rules keep their spec-010 meaning: the user's role must appear in the list. */
function decideByRoles(allowedRoles: string[], user: CmsUser | null): AccessDecision {
  const role = roleOf(user);
  if (role === undefined) return DENIED;
  return allowedRoles.includes(role) ? ALLOWED : DENIED;
}

/**
 * Resolves a collection-level access rule.
 *
 * An `undefined` rule means "this rule is not configured" — the caller decides the fallback (the
 * HTTP layer falls back to its route-level `allowedRoles`, the Local API treats it as public).
 */
export async function resolveAccess(
  rule: AccessRule | undefined,
  args: AccessArgs
): Promise<AccessDecision | undefined> {
  if (rule === undefined) return undefined;
  if (Array.isArray(rule)) return decideByRoles(rule, args.user);

  const result = await rule(args);
  if (typeof result === 'boolean') return result ? ALLOWED : DENIED;
  return { allowed: true, where: result as DatabaseWhere };
}

/** AND-merges an access constraint into a user-supplied query. Access conditions always win. */
export function mergeWhere(
  base: DatabaseWhere | undefined,
  constraint: DatabaseWhere | undefined
): DatabaseWhere | undefined {
  if (!constraint || Object.keys(constraint).length === 0) return base;
  if (!base || Object.keys(base).length === 0) return constraint;
  return { ...base, ...constraint };
}

/**
 * Checks an already-loaded document against an access constraint. Used for update/delete, where the
 * constraint cannot be pushed into the query because the document is addressed by id.
 */
export function documentMatches(doc: Record<string, unknown>, where: AccessQuery): boolean {
  return Object.entries(where).every(([key, condition]) => matchesCondition(doc[key], condition));
}

/** Resolves a field-level rule. `undefined` means unrestricted. */
export async function resolveFieldAccess(
  rule: FieldAccessRule | undefined,
  args: FieldAccessArgs
): Promise<boolean> {
  if (rule === undefined) return true;
  if (Array.isArray(rule)) return decideByRoles(rule, args.user).allowed;
  return rule(args);
}

/** The role string an access check will see for this user — exported for the HTTP layer's messages. */
export function userRoleOf(user: CmsUser | null): string | undefined {
  return roleOf(user);
}

export function accessArgs(
  collection: CollectionDefinition,
  args: Omit<AccessArgs, 'collection'>
): AccessArgs {
  return { ...args, collection };
}
