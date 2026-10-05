/**
 * `@forge-cms/angular/server` — server rendering support (spec 078, roadmap S01). Use it in the server
 * application config / `main.server.ts` only; the browser keeps `provideForgeCms()` alone.
 */
export { provideForgeCmsServer, type ForgeServerConfig } from './server-context.js';
