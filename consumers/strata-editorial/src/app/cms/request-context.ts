import '@strata-sc/server-components/server-only';

import type { EditorialEnv } from './runtime';

/**
 * The immutable per-render value the host gives Angular SSR through `REQUEST_CONTEXT` (Strata's documented
 * request-context seam). It is server-owned: it never reaches a client island or the HTML.
 */
export interface EditorialRequestContext {
  readonly headers: Headers;
  readonly env: EditorialEnv;
}

/**
 * On Cloudflare the bindings live on the H3 event, which Analog does not expose to Angular. A Nitro
 * `request` hook (src/server/plugins/request-env.ts) attaches them to THIS request's own Node-style request
 * object under this non-enumerable key; `main.server.ts` reads them back from Analog's public `REQUEST`
 * token. Request-scoped by construction: no global, no module state.
 */
export const EDITORIAL_ENV_KEY = Symbol.for('forge-strata-editorial.request-env');
