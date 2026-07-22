import type { CollectionDefinition } from '@forge-cms/core';
import type { AdapterSet } from './config.js';

/**
 * The slice of `ForgeCmsRuntime` the operations need. Declared structurally rather than importing
 * the class so `operations.ts` / `populate.ts` never import `runtime.ts` — `runtime.ts` imports
 * *them*, and `import/no-cycle` is an error in this repo.
 *
 * `ForgeCmsRuntime` satisfies this interface structurally; no explicit `implements` is needed.
 */
export interface OperationContext {
  readonly adapters: AdapterSet;
  getCollection(slug: string): CollectionDefinition | undefined;
}
