import { defineEventHandler, setResponseHeader, setResponseStatus } from 'h3';
import { getServerRuntime, type DemoRuntime } from '../../api/runtime';
import { resolveDemoMode } from '../../api/demo-policy';
import { startupFailureBody } from '../../api/startup';

/**
 * The deployment probe. If the runtime cannot start, a `503` names the failed stage (auth,
 * configuration, database, seed) without any secret — the post-deploy check
 * (`scripts/verify-deployment.mjs`) prints it.
 *
 * It proves what a deploy needs proven — the runtime starts, the D1 binding answers, the adapters are
 * known and the seed is present — with **one** `count` of the settings singleton, memoised for
 * {@link PROBE_TTL_MS}. It used to count every collection on every request, which made a public,
 * unauthenticated endpoint a cheap way to spend D1 reads.
 */
const PROBE_TTL_MS = 30_000;

interface Probe {
  at: number;
  seeded: boolean;
}
let lastProbe: Probe | undefined;

async function probe(runtime: DemoRuntime): Promise<boolean> {
  const now = Date.now();
  if (lastProbe && now - lastProbe.at < PROBE_TTL_MS) return lastProbe.seeded;
  const seeded = (await runtime.adapters.database.count('site_settings')) > 0;
  lastProbe = { at: now, seeded };
  return seeded;
}

export default defineEventHandler(async (event) => {
  const env = event.context.cloudflare?.env;
  let runtime: DemoRuntime;
  try {
    runtime = await getServerRuntime(env);
  } catch (error) {
    setResponseStatus(event, 503);
    return startupFailureBody(error);
  }

  const seeded = await probe(runtime);
  setResponseHeader(event, 'cache-control', 'no-store');

  return {
    data: {
      database: runtime.adapters.database.name,
      auth: runtime.adapters.auth.name,
      storage: runtime.adapters.storage.name,
      mode: resolveDemoMode(env),
      seeded
    }
  };
});
