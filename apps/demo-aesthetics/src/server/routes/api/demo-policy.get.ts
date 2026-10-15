import { defineEventHandler, setResponseHeader } from 'h3';
import {
  PUBLIC_EDITABLE,
  PUBLIC_RESTRICTED,
  getBudgetStore,
  resolveDemoMode,
  type PolicySummary
} from '../../api/demo-policy';

const MEMO_MS = 30_000;
let memo: { at: number; remaining: PolicySummary['remaining'] | null } | undefined;

/**
 * Read-only introspection of the active demo policy: which mode this deployment runs in, what a
 * visitor may do, and (public mode only) how much of today's write budget is left. The admin shows a
 * notice from it, and the post-deploy check proves the public policy is active from it without
 * mutating anything. Exposes no secret, id or provider detail.
 */
export default defineEventHandler(async (event) => {
  const env = event.context.cloudflare?.env;
  const mode = resolveDemoMode(env);
  setResponseHeader(event, 'cache-control', 'no-store');

  if (mode === 'full') {
    return { data: { mode, editable: [], restricted: [] } satisfies PolicySummary };
  }

  // One small D1 read at most every 30 seconds per isolate, however often this is polled.
  // (The in-process store used without a D1 binding costs nothing, so it is never memoised.)
  if (!env?.DB || !memo || Date.now() - memo.at > MEMO_MS) {
    memo = { at: Date.now(), remaining: await getBudgetStore(env).remaining() };
  }
  const { remaining } = memo;
  return {
    data: {
      mode,
      editable: PUBLIC_EDITABLE,
      restricted: PUBLIC_RESTRICTED,
      ...(remaining != null && { remaining })
    } satisfies PolicySummary
  };
});
