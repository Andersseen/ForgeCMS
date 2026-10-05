/// <reference types="vite/client" />
import '@angular/platform-server/init';
import { REQUEST } from '@angular/core';
import { bootstrapApplication, type BootstrapContext } from '@angular/platform-browser';
import { renderApplication } from '@angular/platform-server';
import { provideForgeCmsServer } from '@forge-cms/angular/server';
import { AppComponent } from './app/app.component';
import { serverConfig } from './app/app.config.server';

/** Node-style incoming headers, as on Nitro's `event.node.req` (also under the Cloudflare preset). */
type IncomingHeaders = Record<string, string | string[] | undefined>;

/** What Analog's renderer passes (`@analogjs/vite-plugin-nitro`): Nitro's `event.node.req`. */
interface AnalogServerContext {
  req: { headers: IncomingHeaders };
}

const DEV_ORIGIN = 'http://127.0.0.1:5175';

/**
 * Where this server reaches Forge's `/api/*` routes during SSR (spec 078). Explicit configuration,
 * never the incoming `Host` header: `FORGE_SSR_ORIGIN`, or the fixed dev-server origin under `pnpm dev`.
 * Read per render (Cloudflare forbids module-scope I/O and binds env per request).
 */
function serverOrigin(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const configured = env?.['FORGE_SSR_ORIGIN'];
  if (configured) return configured;
  if (import.meta.env.DEV) return DEV_ORIGIN;
  throw new Error('FORGE_SSR_ORIGIN must be set for server rendering');
}

/** A Web `Request` carrying only this request's headers — Angular's standard `REQUEST` value. */
function toWebRequest(url: string, headers: IncomingHeaders): Request {
  const copy = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') copy.set(name, value);
    else if (Array.isArray(value)) copy.set(name, value.join(', '));
  }
  return new Request(new URL(url, 'http://ssr.invalid'), { headers: copy });
}

function bootstrap(context: BootstrapContext) {
  return bootstrapApplication(AppComponent, serverConfig, context);
}

/**
 * Analog's SSR entry: one call per request. `renderApplication` builds a fresh platform + application
 * for it, so `REQUEST`, the Forge server context, `CmsApiService`, `ForgeAuthSession` and every resource
 * belong to this render only. Public pages render anonymously (`forwardCookies` left at `[]`).
 */
export default async function render(
  url: string,
  document: string,
  { req }: AnalogServerContext
): Promise<string> {
  return renderApplication(bootstrap, {
    document,
    url,
    platformProviders: [
      { provide: REQUEST, useValue: toWebRequest(url, req.headers) },
      provideForgeCmsServer({ origin: serverOrigin() })
    ]
  });
}
