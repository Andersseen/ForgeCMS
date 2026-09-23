import type { OperationContext } from './context.js';
import { AuthManagedCollectionError } from './errors.js';

/**
 * Is `slug` a collection whose lifecycle the configured `AuthAdapter` owns (spec 061)? Asked of the
 * adapter through its optional `managesCollection` — the runtime never inspects a concrete adapter or a
 * slug convention, so an adapter that omits the method (or a composite of such adapters) restricts
 * nothing.
 */
export function isAuthManagedCollection(ctx: OperationContext, slug: string): boolean {
  return ctx.adapters.auth.managesCollection?.(slug) === true;
}

/**
 * The generic-mutation boundary. Called first thing by `create`/`update`/`deleteDocumentInternal`/
 * `restoreVersion` — before hooks, access checks and any read or write — so the answer is the same for
 * every caller (`overrideAccess: true` bypasses *authorization*, never the auth subsystem's
 * data-integrity invariants) and for a document that does not exist, and a refusal has no side effects.
 * The message deliberately does not distinguish create/update/delete — the boundary is the same for all
 * three, and the caller's fix (use the auth adapter's own operations) does not depend on which one this
 * was.
 */
export function assertNotAuthManaged(ctx: OperationContext, slug: string): void {
  if (isAuthManagedCollection(ctx, slug)) throw new AuthManagedCollectionError(slug);
}
