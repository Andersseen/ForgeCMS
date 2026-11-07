import { defineEventHandler, setResponseHeader } from 'h3';

import { runtimeFor } from '../../lib/session';

/** Native liveness/readiness: answers 200 only once the durable runtime has started. Never echoes config. */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store');
  try {
    await runtimeFor(event);
    return { status: 'ok' };
  } catch {
    event.node.res.statusCode = 503;
    return { status: 'unavailable' };
  }
});
