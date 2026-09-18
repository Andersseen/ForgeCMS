import type { CmsUser, CollectionDefinition, DraftStatus } from '@forge-cms/core';
import type { DatabaseWhere } from '@forge-cms/db';
import { AccessDeniedError } from './errors.js';
import { resolveAccess } from './access.js';
import type { AccessDecision } from './access.js';

/**
 * Shared read-side policy primitives used by `operations.ts` (`find`/`findByID`/`count`), plus (spec
 * 058) `versions.ts` and `populate.ts` — every path that decides "can this caller see this document"
 * goes through the exact same two functions, instead of each alternate content path reimplementing
 * (and inevitably drifting from) collection/row/draft access. Neither function here imports
 * `operations.ts`, so `versions.ts`/`populate.ts` can depend on this module with no import cycle.
 */

/**
 * Resolves the collection's access rule for an operation.
 *
 * A rule that is not configured yields `undefined`, which every caller treats as "allowed" — the
 * Local API has no route-level fallback to defer to, and the HTTP layer applies its own
 * `allowedRoles` gate *before* calling in.
 */
export async function checkAccess(
  collection: CollectionDefinition,
  operation: 'read' | 'create' | 'update' | 'delete',
  args: {
    user?: CmsUser | null;
    overrideAccess?: boolean;
    id?: string;
    data?: Record<string, unknown>;
    doc?: Record<string, unknown>;
  }
): Promise<AccessDecision> {
  if (args.overrideAccess !== false) return { allowed: true };

  const decision = await resolveAccess(collection.access?.[operation], {
    user: args.user ?? null,
    operation,
    collection,
    ...(args.id !== undefined && { id: args.id }),
    ...(args.data !== undefined && { data: args.data }),
    ...(args.doc !== undefined && { doc: args.doc })
  });

  if (decision === undefined) return { allowed: true };
  if (!decision.allowed) throw new AccessDeniedError();
  return decision;
}

/**
 * The `_status` constraint for a read. Anonymous callers only ever see published documents,
 * whatever they ask for.
 *
 * `defaultStatus` differs by operation, preserving spec 017's behaviour: a **list** stays
 * published-only unless the caller opts in (`?status=draft|all`), because a listing is the surface
 * that leaks unfinished content; a **single read by id** shows drafts to any authenticated caller,
 * since they had to know the id already.
 */
export function statusConstraint(
  collection: CollectionDefinition,
  status: DraftStatus | 'all' | undefined,
  user: CmsUser | null,
  overrideAccess: boolean,
  defaultStatus: DraftStatus | 'all'
): DatabaseWhere | undefined {
  if (collection.drafts !== true) return undefined;

  // Trusted server-side calls see everything unless they ask for a specific status.
  if (overrideAccess) {
    if (status === undefined || status === 'all') return undefined;
    return { _status: status };
  }

  if (!user) return { _status: 'published' };

  const effective = status ?? defaultStatus;
  if (effective === 'all') return undefined;
  return { _status: effective };
}
