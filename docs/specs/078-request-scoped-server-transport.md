# 078 — Request-scoped server transport and SSR identity isolation

- **Status:** done (merged in PR #71; published as npm `0.10.0` by PR #72)
- **Author:** agent draft (implementation requested by the maintainer, 2026-10-05 — "spec 078 — roadmap
  0.9 / S01"; per [SDD.md](../SDD.md) an explicit request to implement counts as approval)
- **Date:** 2026-10-05
- **Branch:** feature/spec-078-request-scoped-server-transport
- **Affected packages/apps:** @forge-cms/angular (new `./server` subpath, server behavior of
  `CmsApiService`), apps/tiny-project (first SSR consumer), scripts (new packed SSR consumer gate), CI,
  apps/www (docs), docs

## Context / Why

Roadmap 0.9 / S01 ([0.9-ssr.md](../roadmap/v1/0.9-ssr.md)), after 0.8 (C01 spec 075, C02 spec 076, C03
spec 077). All three Analog apps set `ssr: false`, their `main.server.ts` files are stubs, and no part of
`@forge-cms/angular` has ever executed on a server. Reading the code against S01:

1. **No server origin.** `provideForgeCms()` defaults to relative `/api/v1` and `/api/auth`. In a browser
   those resolve against `location`; during SSR there is no `location`, so `fetch('/api/v1/…')` throws
   (`Failed to parse URL`) and every resource renders an error. Nothing lets a server state where Forge is.
2. **No server identity.** Browser identity is ambient: `credentials: 'include'` makes the browser attach
   `forge_session`. A server `fetch` has no cookie jar, so during SSR either nobody is signed in or — if an
   app hand-rolled forwarding — something must decide whose cookie is sent, to which origin. The C01
   credential-target rule (`transport.ts` `isCredentialTarget`) falls back to `globalThis.location`, which a
   server must never trust (Analog's own `@analogjs/router/server` derives `BASE_URL` from the request's
   `Host` / `x-forwarded-proto` headers, which the client controls).
3. **SSR completes before data.** `CmsApiService` does not register in-flight requests with Angular's
   `PendingTasks`, so a zoneless server render can serialize while requests are pending ("Loading…").
4. **No teardown.** A request started by `CmsApiService` directly (not through a resource) keeps running
   after its render's application is destroyed.
5. **Caches are safe, but unproven.** Each app's `getServerRuntime()` caches one `ForgeCmsRuntime` per
   isolate. It holds schema and adapters only — identity is passed per operation — which is correct, but no
   test pins that concurrent requests with different identities stay isolated.

## Framework evidence (versions inspected, 2026-10-05)

Read from the installed/published sources, not from memory:

| Package                         | Version           | Fact used by this design                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@angular/core`                 | 21.2.10           | `REQUEST: InjectionToken<Request \| null>` (Web `Request`), `providedIn: 'platform'`, factory `() => null`. `getPlatform()` returns `null` when `ngServerMode` is set, so `createPlatformFactory` never reuses a platform on the server. `PendingTasks` is the public way to hold `whenStable()`.                                                                                   |
| `@angular/platform-server`      | 21.2.10           | `renderApplication(bootstrap, { document, url, platformProviders })` creates a **new** `platformServer` per call, passes `{ platformRef }` to `bootstrap` (`BootstrapContext`), awaits `applicationRef.whenStable()`, serializes, then destroys the platform in a `setTimeout(0)`. So every render has its own platform injector (where `REQUEST` lives) and its own root injector. |
| `@analogjs/vite-plugin-nitro`   | 2.5.2             | Built renderer: `renderer(event.node.req.url, template, { req: event.node.req, res: event.node.res })` per request; `ssr: true` with no `prerender.routes` prerenders `/` at build time (`isEmptyPrerenderRoutes`). Dev server: `ssrLoadModule('~analog/entry-server')` → same call with Node `req`/`res`.                                                                          |
| `@analogjs/vite-plugin-angular` | 2.4.8 / 2.5.2     | Defines `ngServerMode` as a build-time constant for the SSR build, so Angular's own per-platform reset of the global flag never runs mid-render.                                                                                                                                                                                                                                    |
| `@analogjs/router`              | 2.5.2 (not used)  | Generator `main.server.ts` uses `render()` from `@analogjs/router/server`; it provides Analog's own `REQUEST` (Node `IncomingMessage`) and a `BASE_URL` built from `Host`/`x-forwarded-proto`, and peers `@analogjs/content`. Forge does **not** depend on it: the design reads Angular's standard `REQUEST`, which `@angular/ssr`'s `AngularAppEngine` also provides.              |
| `nitropack` / `h3`              | 2.13.4 / 1.15.0   | `event.node.req.headers` is available under both the Node and the `cloudflare-pages` presets (unenv shim on Cloudflare).                                                                                                                                                                                                                                                            |
| Cloudflare Pages / Workers      | compat 2026-05-15 | Module scope must not perform I/O (existing lazy runtime rule). Not certified by S01: a Pages Function `fetch()`ing its own public origin during SSR. S01's server transport omits the `credentials` fetch field (no cookie jar exists on a server) and never relies on it. S03 owns the deployed profiles.                                                                         |

Conclusion: Angular already gives every render a fresh platform + root injector. `CmsApiService`,
`ForgeAuthSession` and every resource are `providedIn: 'root'` / injection-context bound, so they are
per render **as long as Forge stores nothing outside DI**. The work is (a) a server origin and identity
policy resolved from DI, (b) `PendingTasks` + teardown, (c) proof.

## Goal

During SSR, every ForgeCMS request executes with an explicit, request-local origin and identity: no
cookie, `Authorization` header, user, resource state or credential-bearing transport can leak between
concurrent renders, and a browser using `provideForgeCms()` behaves exactly as before.

## Non-goals

- **S02:** `TransferState`, serialized CMS responses, hydration cache keys, TTL/stale time, duplicate-fetch
  avoidance, `provideClientHydration()`. In S01 the browser fetches again after bootstrap; that is expected.
- **S03:** the production consumer journey (publish → render → change), deployed profiles, `apps/www` /
  `apps/demo-aesthetics` SSR. Both stay `ssr: false` and unchanged.
- Authenticated/admin dashboard SSR as a requirement (roadmap non-goal). The service must not crash on the
  server and identity forwarding is supported and tested, but the admin is not server rendered.
- A `@forge-cms/analog` package, a generic reverse proxy, a Forge request-context singleton, any SSR
  response cache, Cloudflare self-subrequest certification, portable storage/S3.
- Changing the Local API, HTTP handlers, the envelope, or adapter contracts.

## Design

### Two server consumption paths

| Server code                                                                                                                        | Use                                                                                                                               | Why                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A server route / loader / seed that already owns a `ForgeCmsRuntime` (`src/server/**`)                                             | **Local API**: `runtime.find({ collection, overrideAccess: false, user, depth, locale, … })` (and `findOne`, `findByID`, globals) | Same pipeline (access, hooks, drafts, population) with no HTTP hop, no fabricated `Request`. The caller states the identity: `user: null` for public, or a user it resolved itself (`auth.requireAuth`). |
| An Angular component/resource that must run on both browser and server (`collectionResource`, `ForgeAuthSession`, `CmsApiService`) | **HTTP** through `CmsApiService` with `provideForgeCmsServer()` on the server                                                     | One client abstraction for both platforms; components never import the runtime (which would pull server code into the browser bundle).                                                                   |

`overrideAccess` keeps its existing defaults (`true` on Local API calls, `false` + resolved user on HTTP).
S01 does not force either path onto the other.

### New public API — `@forge-cms/angular/server`

A new package subpath (like `./vite`), so the server-only provider is visibly separate from browser code.
It has no Node/Nitro/H3/Cloudflare imports — only `@angular/core`.

```ts
// @forge-cms/angular/server
export interface ForgeServerConfig {
  /**
   * The absolute `http:`/`https:` origin Forge is reachable at from this server, e.g.
   * `'http://127.0.0.1:3000'` or `'https://site.example'`. Relative `baseUrl` / `authBaseUrl` resolve
   * against it during SSR, and it is the only origin (with `ForgeCmsConfig.trustedOrigins`) that may receive
   * forwarded credentials. Never derived from the incoming `Host` / `Forwarded` headers.
   */
  origin: string;
  /**
   * Names of the incoming request's cookies forwarded (as a `cookie` header) to credential targets.
   * Default `[]`: anonymous SSR. `['forge_session']` renders as the visiting cookie-session user.
   */
  forwardCookies?: readonly string[];
  /** Forward the incoming `Authorization` header to credential targets. Default `false`. */
  forwardAuthorization?: boolean;
}

/** Server-only providers. Ignored on a browser platform. */
export function provideForgeCmsServer(config: ForgeServerConfig): Provider[];
```

Wiring (Analog, no `@analogjs/router` required):

```ts
// src/main.server.ts
import '@angular/platform-server/init';
import { REQUEST } from '@angular/core';
import { bootstrapApplication, type BootstrapContext } from '@angular/platform-browser';
import { renderApplication } from '@angular/platform-server';
import { provideForgeCmsServer } from '@forge-cms/angular/server';
// app.config.server.ts = mergeApplicationConfig(appConfig, { providers: [provideServerRendering()] })

export default async function render(
  url: string,
  document: string,
  { req }: { req: IncomingMessage }
) {
  return renderApplication(
    (context: BootstrapContext) => bootstrapApplication(App, config, context),
    {
      document,
      url,
      platformProviders: [
        { provide: REQUEST, useValue: toWebRequest(url, req) }, // headers of THIS request only
        provideForgeCmsServer({ origin: serverOrigin() }) // explicit, per render
      ]
    }
  );
}
```

`provideForgeCmsServer` can equally go into `app.config.server.ts` when the origin is a constant.

### Resolution (internal, `server-token.ts` + `server-context.ts`)

`CmsApiService` imports only `server-token.ts`: the `FORGE_SERVER_CONTEXT` token and the
`ForgeServerContext` interface (`origin`, `assertCompatible(config)`, `request(input, config)`,
`transport`). The implementation — origin validation, cookie selection, the credential-target check,
the server fetch transport — lives in `server-context.ts`, reachable only through
`provideForgeCmsServer`, so a browser bundle that never imports `@forge-cms/angular/server` does not
contain it (checked by `pnpm release:ssr`).

`provideForgeCmsServer(config)` provides an internal token whose factory runs **once per injector that
resolves it** (per render), reading `inject(REQUEST)` and `inject(PLATFORM_ID)`:

- not `'server'` platform → `null` (browser behavior untouched);
- `origin` validated: parses with `new URL`, protocol `http:`/`https:`, no username/password, and equals
  its own `.origin` once a single trailing `/` is dropped (no path/query/hash). Otherwise it **throws**
  `TypeError('ForgeCMS: invalid server origin …')` — a misconfigured server fails the render, never falls back;
- each `forwardCookies` entry must be a cookie-name token (RFC 6265), else `TypeError`;
- from `REQUEST` (a Web `Request`, or `null` → anonymous): the `cookie` header is reduced to the listed
  names (exact name match, first occurrence, original `name=value` text kept); `authorization` is kept
  only when `forwardAuthorization`. Nothing else is read — not `Host`, `Forwarded`, `X-Forwarded-*`, URL.

The result is a frozen object (`origin`, `transport`, `assertCompatible()`, `request()`) holding the
selected cookie/authorization privately in its closure. It lives only in that render's injector.

### `CmsApiService` on the server

Detected through `inject(PLATFORM_ID) === 'server'`. On a browser platform every line below is skipped.

| Situation                                                                        | Behavior                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL relative (`/api/v1`)                                                    | Resolved against the server `origin` → `http://origin/api/v1/…`.                                                                                                                                                                                                                                                                                                                 |
| Base URL absolute                                                                | Used as given.                                                                                                                                                                                                                                                                                                                                                                   |
| Credential target                                                                | URL origin === server `origin`, or listed in `ForgeCmsConfig.trustedOrigins`. `globalThis.location` is never consulted. Protocol-relative / malformed → not a target.                                                                                                                                                                                                            |
| Forwarded `cookie`                                                               | Sent only to the configured server `origin` (never to `trustedOrigins`: a browser never sends a site's cookie to another origin — tightened after review), only if `ForgeCmsConfig.credentials !== 'omit'`.                                                                                                                                                                      |
| Forwarded `authorization`                                                        | Sent only to a credential target (origin or `trustedOrigins`, the browser `authToken` rule), never on login/signup/logout. A custom `transport` receives it too and must not follow redirects with it.                                                                                                                                                                           |
| `ForgeCmsConfig.authToken` (app-owned server credential or app-chosen token)     | Sent as today (Bearer, credential targets only). **Combining** it with any forwarding (`forwardCookies` non-empty or `forwardAuthorization`) is a configuration error: `TypeError` at `CmsApiService` construction. Visitor and app identities never mix.                                                                                                                        |
| `credentials: 'omit'` with `forwardCookies` non-empty                            | No cookie is forwarded by that client (browser semantics). Originally specified as a `TypeError`; changed after review because the route-level anonymous client below must coexist with visitor forwarding.                                                                                                                                                                      |
| Transport request                                                                | `credentials: 'omit'` (no server cookie jar). Default server transport = `globalThis.fetch(url, { method, headers, body, signal, redirect: 'manual' })` — no `credentials` field; a redirect is never followed with forwarded credentials (a 3xx is a non-ok response → `ForgeApiError` `kind: 'http'`). A custom `transport` receives the same request, cookie header included. |
| Server platform, **no** `provideForgeCmsServer`, relative URL, default transport | No request is made; the call rejects with `ForgeApiError({ kind: 'network', code: 'SERVER_ORIGIN_REQUIRED' })`. Resources show it as `error()`; `ForgeAuthSession` goes to `'error'`. A custom `transport` is still called (it may route relative URLs in-process).                                                                                                              |
| Server platform, **no** `provideForgeCmsServer`, absolute URL                    | Sent without any forwarded identity; `location` is never consulted (only `trustedOrigins` may receive a configured `authToken`); no `credentials` field, `redirect: 'manual'`.                                                                                                                                                                                                   |
| Any request                                                                      | Wrapped in `PendingTasks` so `renderApplication` waits for it.                                                                                                                                                                                                                                                                                                                   |
| Application destroyed (end of render)                                            | Every in-flight request is aborted (lifetime `AbortController` combined with the caller's signal) → `kind: 'aborted'`; resources already abort through their effect cleanup.                                                                                                                                                                                                     |

`ForgeAuthSession` needs no change: it is per render, its constructor `/me` goes through the rules above
(anonymous → `401` → `'anonymous'`; forwarded session → `'authenticated'`; outage → `'error'`), it touches
no browser global, and its bootstrap promise belongs to its own instance.

### `angularLinker()` in SSR builds

Found by the packed consumer: an SSR build externalizes `node_modules`, so the server loads Forge's
partial-Ivy output unlinked and every render fails with `JIT compilation failed for injectable [class
CmsApiService]`. `angularLinker()` (`@forge-cms/angular/vite`, re-exported by `@forge-cms/admin/vite`)
therefore adds a `config()` hook returning `{ ssr: { noExternal: ['@forge-cms/angular',
'@forge-cms/admin'] } }` (Vite merges it with the app's). No extra consumer configuration; the packed
consumer has none.

### What is shared and what is request-scoped

| Scope                                   | State                                                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Isolate / process (safe, immutable use) | `ForgeCmsRuntime` (schema, adapters, DB connection), Angular compiled component defs, `ForgeServerConfig` constants, the module-level `WeakMap` in `credentials.ts` (keyed by service instance; holds nothing shared).    |
| Render (platform + root injector)       | `REQUEST`, resolved server context (origin + forwarded cookie/authorization), `CmsApiService` (requester, 401 listeners, credential revision, lifetime controller), `ForgeAuthSession` (user, status, bootstrap promise). |
| Injection context / owner               | Each resource's state, `AbortController`s.                                                                                                                                                                                |
| Never                                   | A module/global "current request", "current user" or cookie/header store; identity on the runtime.                                                                                                                        |

### First SSR consumer — `apps/tiny-project`

Smallest external-style consumer; `www`/`demo` stay SPA.

- `vite.config.ts`: `analog({ ssr: true, prerender: { routes: [] }, nitro: { preset: 'cloudflare-pages' } })`
  (empty routes: no build-time prerender of `/` against an empty build-time database).
- `src/main.server.ts`: the wiring above; `toWebRequest` copies only the incoming headers into a Web
  `Request`. Origin: `FORGE_SSR_ORIGIN`, or `http://127.0.0.1:5175` under the dev server only; a production
  render without it throws (fails the request) rather than guessing from `Host`.
- `src/app/app.config.server.ts`: `mergeApplicationConfig(appConfig, { providers: [provideServerRendering()] })`.
- Public pages (`home`, `posts/:slug`) read through `collectionResource` (anonymous `/api/v1/posts`,
  published only) instead of raw relative `fetch`, which cannot run on a server. Anonymous SSR
  (`forwardCookies` default `[]`): the HTML is public content.
- `/api/site/*` stay as the Local API server-route example.
- The public routes get their own anonymous client (route-level `provideForgeCms({ credentials: 'omit' })`
  - `CmsApiService`), preserving the golden path's "public pages read as anonymous even for a signed-in
    editor" in the browser.
- `rxjs` leaves `ssr.noExternal` (inlined, Vite's SSR runner evaluated its CommonJS build).
- `wrangler.toml` `[vars] FORGE_SSR_ORIGIN = "http://127.0.0.1:8788"` for local `wrangler pages dev` only
  (tiny-project is not deployed).
- The packed consumer inlines `@forge-cms/*`/`drizzle-orm` and aliases `@libsql/client` to its web build in
  its Nitro config — a workaround for a non-SSR `@forge-cms/db` packaging finding (see Outcome).
- Dependency added: `@angular/platform-server` 21.2.10.

### Evidence fixtures

1. **Package unit tests** (`packages/angular/src/server-transport.test.ts`): a real `platformServer` +
   `bootstrapApplication` per case, with `REQUEST` and a stubbed `fetch`.
2. **Concurrent SSR integration** (`apps/tiny-project/src/tests/ssr-isolation.integration.test.ts`): a real
   `ForgeCmsRuntime` (InMemory, `UsersCollectionAuthAdapter`) with users A and B and a test-local `notes`
   collection whose `access.read` is `({ user }) => user ? { or: [{ owner: user.id }, { visibility: 'public' }] } : { visibility: 'public' }`
   (one public, one A-only, one B-only note), served by a `node:http` server over the real handlers;
   delays per session make completion order deterministic. Real `renderApplication` renders of a component
   using `collectionResource` + `ForgeAuthSession` with `provideForgeCmsServer({ forwardCookies: ['forge_session'] })`.
   The Local API case resolves the user itself and calls `runtime.find` with no HTTP.
3. **Packed production SSR consumer** (`scripts/verify-ssr-consumer.mjs`, `pnpm release:ssr`): an external
   Analog app (`@analogjs/platform`, `node-server` preset) installed from packed tarballs with strict peers,
   built for production, started with `node dist/analog/server/index.mjs`, and exercised over real HTTP:
   anonymous/A/B concurrent renders, HTML content, linker, browser-bundle scan.

## Implementation plan

- [x] 1. `packages/angular`: `server-context.ts` (token, validation, header extraction), `server.ts`
     (subpath entry), `package.json` `exports["./server"]`.
- [x] 2. `transport.ts` / `api.service.ts`: server base resolution, server credential target, forwarding,
     server fetch transport, `SERVER_ORIGIN_REQUIRED`, config conflicts, `PendingTasks`, lifetime abort.
- [x] 3. `server-transport.test.ts` (+ browser regression cases unchanged).
- [x] 4. tiny-project: dependency, `ssr: true`, `main.server.ts`, `app.config.server.ts`, pages on
     `collectionResource`.
- [x] 5. tiny-project: `ssr-isolation.integration.test.ts` (concurrent anonymous/A/B, failure, abort,
     teardown, auth session, Local API).
- [x] 6. tiny-project e2e: no-JS HTML assertions for `/` and `/posts/:slug` against the SSR dev server.
- [x] 7. `scripts/verify-ssr-consumer.mjs` + `pnpm release:ssr` + CI step.
- [x] 8. Docs: new `ssr.md` guide, Angular guide pointer, tiny-project README; API baseline.
- [x] 9. Changeset (minor, see below), STATE, roadmap.
- [x] 10. Gates.

## Acceptance criteria

1. `provideForgeCms()` in a browser: same URLs, `credentials: 'include'`, no server config required — the
   existing `transport.test.ts` / `api.service.test.ts` / `resources.test.ts` pass unchanged.
2. On a server platform with `provideForgeCmsServer({ origin })`, `/api/v1/…` is requested as
   `${origin}/api/v1/…`; no access to `window`/`location`/`document.cookie` (tests run with those absent).
3. Anonymous request (no `REQUEST`, or no listed cookie) sends neither `cookie` nor `authorization`.
4. Listed cookies (only those) reach the configured origin only, and, when enabled, `authorization` reaches credential targets only; another
   origin, a protocol-relative URL and a malformed URL receive neither; `Host` / `X-Forwarded-Host` never
   change the target.
5. Invalid `origin`, invalid cookie name and `authToken` + forwarding throw; a `credentials: 'omit'` client forwards no cookie.
6. Server platform without server config → `SERVER_ORIGIN_REQUIRED`, no fetch.
7. Concurrent interleaved SSR renders (anonymous, A, B; all 6 completion orders, repeated) each contain only
   their own allowed notes and their own `/me` user; a failing render and an aborted render leave the others
   correct; distinct `CmsApiService`/`ForgeAuthSession` instances per render.
8. Destroying a render's application aborts its in-flight requests.
9. A Local API loader returns the same per-identity result with zero HTTP requests.
10. tiny-project serves server-rendered HTML containing a published post title (no JS) and the
    `cloudflare-pages` production build succeeds with `ssr: true`.
11. `pnpm release:ssr`: strict install from tarballs, production build, built server answers with
    server-rendered HTML; concurrent anonymous/A/B HTTP renders isolated; the browser bundle has no
    unlinked declarations, no `provideForgeCmsServer`/server-context code, no runtime/H3/Nitro code and no
    server secret marker.
12. `pnpm release:compat` (C03) stays green; `pnpm check:api` shows only `@forge-cms/angular/server` added.

## Test plan

```
pnpm --filter @forge-cms/angular test
pnpm --filter @forge-cms/tiny-project test
pnpm e2e:tiny-project
pnpm release:ssr
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm check:api && pnpm release:verify && pnpm release:compat
pnpm e2e:www && pnpm e2e:demo
```

`test:cloudflare` / `test:libsql` / `test:upgrade`: no backend, adapter, runtime or schema change in this
spec — their existing evidence is inherited, not re-claimed (record what actually ran in the Outcome).

## Versioning

`@forge-cms/angular` gains an intentional public surface (`./server` subpath, `ForgeServerConfig`,
`provideForgeCmsServer`) and a documented server contract (`SERVER_ORIGIN_REQUIRED`, server credential
rules). No browser behavior or existing signature changes. Roadmap policy: SSR is the next minor line and a
minor communicates a capability/guarantee change → **minor** changeset (fixed group → npm `0.10.0`). Not a
patch (new contract), not breaking (purely additive; the server path never worked before).

## Open questions

None blocking. Recorded decisions: anonymous SSR by default (a cached SSR page can never embed a visitor's
session by accident); fixed origin only (no request-derived origin mode in S01).

## Outcome

Implemented as designed, with three refinements made during implementation and recorded above:
the token/implementation split (`server-token.ts`), `angularLinker()`'s `ssr.noExternal` hook (the packed
consumer proved an external Forge package fails SSR with a JIT error), and — after the rules review —
forwarded cookies go to the configured origin only, never to `trustedOrigins`; after the spec review, a
`credentials: 'omit'` client no longer throws with `forwardCookies` (it forwards none), and a server render
without the provider no longer consults `location` or follows redirects for absolute URLs.

Also found: the tiny-project public pages had to move off raw relative `fetch` (impossible on a server); to
keep the golden path's "public pages read as anonymous even for a signed-in editor", they use a
route-level anonymous client. Not S01: `@forge-cms/db`'s static `@libsql/client` import breaks Nitro
`node-server` tracing for InMemory-only consumers (worked around in the packed consumer; follow-up task).

Evidence, newly executed 2026-10-05: `@forge-cms/angular` 200 tests (33 in `server-transport.test.ts`, 1
in `vite-linker.test.ts`); tiny-project 46 tests (7 in `ssr-isolation.integration.test.ts`; a global-cache
mutation fails 4); format:check, lint, typecheck, test, build, check:api, release:verify, release:compat
(5/5), release:ssr, e2e:www 25/25, e2e:demo 29/29, e2e:tiny-project 14/14, test:cloudflare, test:libsql.
Manual: tiny-project production build under `wrangler pages dev` (local workerd + D1) rendered a published
post. Not run: test:upgrade (no schema/backend change; inherited from CI). Changeset: `@forge-cms/angular`
minor (→ `0.10.0`).
