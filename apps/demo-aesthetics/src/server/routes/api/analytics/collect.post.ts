import { createError, defineEventHandler, getRequestHeader, getRequestURL, readBody } from 'h3';
import { collectPageview } from '../../../analytics/collect';
import type { ServerEnv } from '../../../api/runtime';

/**
 * Forge Analytics (spec 057, experimental) - the public pageview collector. Public and anonymous by
 * design, so this is a bespoke route rather than generic CRUD: pageviews are not a CMS collection and
 * must never require auth. The logic lives in `analytics/collect.ts` (tested, and embedded in the guide).
 */
export default defineEventHandler(async (event) => {
  const env = event.context.cloudflare?.env as ServerEnv | undefined;

  let parsed: unknown;
  try {
    parsed = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' });
  }

  collectPageview({
    body: parsed,
    env,
    requestHost: getRequestURL(event).hostname,
    countryHeader: getRequestHeader(event, 'cf-ipcountry')
  });

  return new Response(null, { status: 204 });
});
