import type { ForgeCmsRuntime } from '@forge-cms/runtime';

/**
 * The current runtime, for code that needs to query the CMS but is not handed it.
 *
 * FINDING 23: collection hooks receive `data`, `doc`, `user` and `operation` — but no handle on the
 * CMS itself. Any rule that has to *look something up* (how many documents exist, does this slug
 * collide, is this the last admin) therefore reaches for a module-level singleton like this one.
 * Payload passes a `req` carrying its instance; ForgeCMS should pass the `OperationContext` it
 * already has in `operations.ts`.
 *
 * It lives in its own module so `collections.ts` → `demo-guards.ts` → here does not close a cycle
 * back through `runtime.ts` (`import/no-cycle` is an error in this repo).
 */
let current: ForgeCmsRuntime<unknown> | undefined;

export function setRuntimeRef(runtime: ForgeCmsRuntime<never>): void {
  current = runtime as unknown as ForgeCmsRuntime<unknown>;
}

export function getRuntimeRef(): ForgeCmsRuntime<unknown> | undefined {
  return current;
}
