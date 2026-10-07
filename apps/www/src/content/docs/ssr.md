---
title: Server rendering
description: Analog SSR with ForgeCMS — Local API in server routes, a request-scoped CmsApiService in Angular renders, how identity is forwarded, and opt-in public hydration transfer.
group: Client & deploy
order: 1.5
---

Server code has two ways to read CMS content. Pick per call site; neither is "the consistent one".

| Where the code runs                                                                | Use                                       | Why                                                                                                         |
| ---------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| A server route, loader or script that already has the `ForgeCmsRuntime`            | [Local API](/docs/local-api)              | Same access/hooks/drafts pipeline, no HTTP hop, no fabricated `Request`. You state the identity.            |
| An Angular component or resource that renders in the browser **and** on the server | `CmsApiService` + `provideForgeCmsServer` | One client for both platforms; components never import the runtime (it would end up in the browser bundle). |

> **S01 = request-safe SSR. S02 = optional, anonymous public result transfer.** Server rendering
> works with request-scoped identity (S01). On top of it, a public read can opt in to hydrate the
> browser from the server's result without repeating the request ([below](#hydration-and-public-transfer)).
> Nothing is transferred unless you ask.

## Server routes: the Local API

```ts
// src/server/routes/api/site/my-notes.get.ts
import { defineEventHandler, toWebRequest } from 'h3';
import { getServerRuntime } from '../../../api/runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  // Public content: say so explicitly. Personalized: resolve the user from THIS request.
  const user = await runtime.adapters.auth.requireAuth(toWebRequest(event)).catch(() => null);
  const result = await runtime.find({
    collection: 'notes',
    overrideAccess: false, // run the collection's access rules for `user`
    user,
    depth: 1
  });
  return { data: result.docs };
});
```

`overrideAccess` defaults to `true` on the Local API (trusted code). Pass `false` plus the user
whenever the result goes back to a visitor. `user: null` is an anonymous read.

## Angular SSR: `CmsApiService` on the server

During SSR there is no `window.location` to resolve `/api/v1` against, and no browser cookie jar.
`@forge-cms/angular/server` supplies both explicitly, per render:

```bash
pnpm add @angular/platform-server
```

```ts
// vite.config.ts
import analog from '@analogjs/platform';
import { angularLinker } from '@forge-cms/angular/vite';

export default defineConfig({
  plugins: [
    angularLinker(), // links Forge in the browser AND the server build — nothing else to configure
    analog({ ssr: true, prerender: { routes: [] } })
  ]
});
```

`prerender.routes: []` stops Analog from prerendering `/` at build time (it does so by default when
`ssr: true`), which would render against your build machine's database.

```ts
// src/app/app.config.server.ts
import { mergeApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';
import { appConfig } from './app.config';

export const serverConfig = mergeApplicationConfig(appConfig, {
  providers: [provideServerRendering()]
});
```

```ts
// src/main.server.ts
import '@angular/platform-server/init';
import { REQUEST } from '@angular/core';
import { bootstrapApplication, type BootstrapContext } from '@angular/platform-browser';
import { renderApplication } from '@angular/platform-server';
import { provideForgeCmsServer } from '@forge-cms/angular/server';
import { AppComponent } from './app/app.component';
import { serverConfig } from './app/app.config.server';

type IncomingHeaders = Record<string, string | string[] | undefined>;

/** Only this request's headers, as Angular's standard `REQUEST` (a Web `Request`). */
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

// Analog calls this once per request with Nitro's `event.node.req`.
export default async function render(
  url: string,
  document: string,
  { req }: { req: { headers: IncomingHeaders } }
) {
  return renderApplication(bootstrap, {
    document,
    url,
    platformProviders: [
      { provide: REQUEST, useValue: toWebRequest(url, req.headers) },
      provideForgeCmsServer({ origin: process.env['FORGE_SSR_ORIGIN']! })
    ]
  });
}
```

The browser config is unchanged: `provideForgeCms()` keeps its relative `/api/v1`, `/api/auth` and
cookie defaults and needs no SSR option. `provideForgeCmsServer` is ignored on a browser platform.
Resources render their resolved state on the server — the render waits for every Forge request.

### `provideForgeCmsServer(config)`

| Option                 | Default    | Meaning                                                                                                            |
| ---------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| `origin`               | (required) | Absolute `http(s)` origin this server reaches Forge at, e.g. `'http://127.0.0.1:3000'` or `'https://site.example'` |
| `forwardCookies`       | `[]`       | Incoming cookies forwarded to Forge, e.g. `['forge_session']` to render as the visiting signed-in user             |
| `forwardAuthorization` | `false`    | Forward the incoming `Authorization` header                                                                        |

**Where the origin comes from.** Configuration only — an environment variable, a constant. It is never
derived from the request's `Host`, `Forwarded` or `X-Forwarded-*` headers, which the client controls.
An origin with a path, query, credentials or another scheme throws, and the render fails rather than
guessing. Relative `baseUrl`/`authBaseUrl` resolve against it; absolute ones are used as given.

**Identity is anonymous by default.** With no `forwardCookies`/`forwardAuthorization`, the server
renders as an anonymous visitor even if the browser sent a session cookie — so a cached SSR page can
never embed someone's private content by accident. To render as the visitor:

```ts
provideForgeCmsServer({ origin, forwardCookies: ['forge_session'] }); // cookie session (spec 053)
provideForgeCmsServer({ origin, forwardAuthorization: true }); // Bearer clients
```

Only the listed cookies are forwarded (other cookies on the request are dropped), and only to the
configured `origin` — a cookie belongs to this site, so a server never sends it anywhere a browser
wouldn't. A forwarded `Authorization` header follows the `authToken` rule: the `origin` and origins
listed in `provideForgeCms({ trustedOrigins })`. Any other absolute URL — another host, port or scheme,
a protocol-relative `//host` URL, a malformed URL — gets the request with neither. The default server
transport never follows redirects; a custom `transport` receives the forwarded headers too and must
not follow a redirect with them. Document ids and slugs are encoded path segments, so content cannot
move a request to another origin.

**App credentials are separate.** A server-owned key (`provideForgeCms({ authToken })`) is sent as
`Bearer` to credential targets. Combining it with `forwardCookies`/`forwardAuthorization` throws at
startup: an app credential and a visitor identity are never sent together. A client configured with
`credentials: 'omit'` never receives forwarded cookies.

**Without `provideForgeCmsServer`**, a server render's calls to a relative URL reject with
`ForgeApiError({ kind: 'network', code: 'SERVER_ORIGIN_REQUIRED' })` without sending anything; resources
show it as `error()` and `ForgeAuthSession` goes to `'error'`. An absolute URL is requested without
forwarded identity; only `trustedOrigins` may receive a configured `authToken`. A custom `transport` (`provideForgeCms({
transport })`) is still called, and receives the forwarded `cookie` header like the default one.

### A public site that stays anonymous for signed-in editors

On the server the default is anonymous; in the browser the app-wide client sends the cookie. To keep
public pages anonymous on both (drafts and restricted relations never shown to an editor browsing the
public site), give those routes their own client — it also works next to `forwardCookies`, since a
`credentials: 'omit'` client never receives forwarded cookies:

```ts
// app.routes.ts
{
  path: '',
  providers: [provideForgeCms({ credentials: 'omit' }), CmsApiService],
  children: [/* public pages using collectionResource / documentResource */]
}
```

## Hydration and public transfer

Add Angular's hydration to the **shared** app config so the browser reuses the server's DOM. Forge uses
its own fetch transport, not `HttpClient`, so Angular's `HttpClient` transfer cache has nothing to do:

```ts
// src/app/app.config.ts
import { provideClientHydration, withNoHttpTransferCache } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [provideClientHydration(withNoHttpTransferCache()) /* … */]
};
```

By default the browser still reads the content again after it starts (and the list re-renders from
empty). A public read can opt in to transfer instead:

```ts
// the route's own anonymous client (see above): credentials 'omit', no authToken
providers: [provideForgeCms({ credentials: 'omit' }), CmsApiService],

// in a component under it
readonly posts = collectionResource(() => ({ collection: 'posts', limit: 10 }), { transfer: 'public' });
readonly post = documentResource(() => ({ collection: 'posts', id: this.id() }), { transfer: 'public' });
```

The server serializes the successful result with Angular's own transfer state (escaped by Angular, so
content like `</script>` is safe); the first browser render of the same logical read uses it with **no
request**, and the DOM is hydrated, not replaced.

- **Opt-in and anonymous only.** The client must be anonymous by construction: `credentials: 'omit'`,
  no `authToken`, and (on the server) no forwarded `Authorization`. Anything else throws a `TypeError`
  when the resource is created (a server render without `provideForgeCmsServer` is refused too) — Forge
  never serializes a signed-in visitor's response. A custom `transport` that attaches its own identity
  is outside this guarantee: opt in only when your transport sends none. Keep the public
  routes on their own client, as in the previous section.
- **Never transferred:** `ForgeAuthSession`, `/me`, users, login/logout, previews, anything from a
  resource that did not opt in, errors, cookies, tokens and request/credential state. Authenticated SSR
  stays request-safe (S01) but has no transfer.
- **Not a cache.** The result belongs to one server-rendered document and its first hydration. It is
  dropped when the app first becomes stable. `reload()`, any change of page, offset, sort, `where`,
  `depth`, `locale` or document id, a later route, and a full page load all make real requests (a full
  page load gets fresh server data). Identical resources in the first render share one transferred
  result, so they don't each refetch.
- **Errors are never transferred.** A failed server read renders the normal error state and writes
  nothing; the browser fetches after it starts and recovers (that subtree re-renders).
- **Keys** are the logical read — the configured `baseUrl`, collection or document, and the full query —
  not the server's absolute origin, so server and browser agree.
- **Local API server routes** are separate: their results are not bridged into Angular state.

## What is request-scoped

Angular's `renderApplication` creates a new platform and application per request, and Forge keeps
everything it knows about a request inside that application's injectors:

| Scope                    | State                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Per render               | `REQUEST`, the forwarded cookie/authorization, `CmsApiService`, `ForgeAuthSession` (user, status), credential revision |
| Per component / resource | Resource values, errors, `AbortController`s                                                                            |
| Process / isolate (safe) | The `ForgeCmsRuntime` (schema, adapters, connections) — identity is passed per operation                               |

There is no global "current user" or "current request": two concurrent renders can never read each
other's cookie or result. When a render's application is destroyed, its in-flight Forge requests are
aborted. `ForgeAuthSession` runs its `/me` bootstrap per render: anonymous → `'anonymous'`, forwarded
session → `'authenticated'`, outage → `'error'`. The admin UI is not meant to be server rendered; its
guard simply resolves on the server as anonymous and the browser takes over.

## Deployment notes: two proven production profiles

`pnpm release:ssr` (spec 081, roadmap 0.9 S03) installs a consumer **from packed tarballs only** and walks the
same journey on **built production servers** — never a dev server: first-admin bootstrap → sign in → create a
draft in the admin → draft invisible to anonymous SSR and to a signed-in browser's public page → publish →
no-JS HTML with the real title and body → hydration with **one** server read and **zero** duplicate browser
reads → edit (the loaded page is _not_ changed) → SPA navigation reads normally → full reload is a fresh SSR
carrying the edit → server restart (content persists) → back to draft (hidden everywhere). Restricted relation
data (`author -> users`: email, id, hashes, `_sessionVersion`, roles), cookies, tokens and `AUTH_SECRET` never
appear in the HTML, the transfer state, the hydrated DOM or any browser bundle.

Both profiles use `provideForgeCmsServer({ origin })`, a public client with `credentials: 'omit'`, Angular
hydration and `{ transfer: 'public' }` exactly as above.

### Cloudflare Pages + D1

Analog with the `cloudflare-pages` Nitro preset, a `DB` D1 binding, `AUTH_SECRET` (≥ 32 bytes) and
`FORGE_SSR_ORIGIN`. `D1DatabaseAdapter` needs no native module and no extra bundler configuration. Evidence is
**local**: the Pages output served by `wrangler pages dev` (workerd) with a real local D1 database persisted on
disk. It is **not** a remote Cloudflare deployment and S03 does not certify one. With `nodejs_compat`,
`process.env` carries your bindings (compatibility date 2026-05-15); rendering fetches your own origin (a
subrequest). Server routes that only need public data can use the Local API instead.

### Node + libSQL

Analog with the `node-server` preset and the portable database:

```ts
// runtime: the database follows the environment
const database = env.DATABASE_URL
  ? new LibSqlDatabaseAdapter(env.DATABASE_URL) // e.g. DATABASE_URL=file:/var/lib/app/forge.db
  : new InMemoryDatabaseAdapter(); // development only
```

Configure Nitro so native libSQL stays installed instead of being traced into the server output (Nitro's
`externals.trace` option: when `false`, externalized dependencies are referenced from `node_modules` instead
of being traced and copied; checked against nitropack 2.13):

```ts
// vite.config.ts
analog({ ssr: true, nitro: { preset: 'node-server', externals: { trace: false } } });
```

libSQL ships a per-platform native package that Nitro's tracer cannot follow, so **production must ship
`node_modules` beside `dist/`** (`pnpm install --prod` on the target, then `node dist/analog/server/index.mjs`
from the project directory with `AUTH_SECRET`, `DATABASE_URL` and `FORGE_SSR_ORIGIN` set). Apps that only use
`InMemoryDatabaseAdapter` or `D1DatabaseAdapter` need none of this: `@forge-cms/db` loads libSQL on the first
database operation, so merely importing the package no longer pulls the native module in. Content survives
process restarts (proven against a real on-disk file).

> **libSQL is the durable _database_. `InMemoryStorageAdapter` is not durable _file_ storage.** Uploaded
> files on the Node profile are not persistent yet; the complete portable files profile is roadmap 0.10
> (P01–P03). Do not treat libSQL + `InMemoryStorageAdapter` as the final portable profile.
