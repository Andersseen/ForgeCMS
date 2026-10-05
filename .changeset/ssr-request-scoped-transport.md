---
'@forge-cms/angular': minor
---

Server rendering with request-scoped identity (spec 078, roadmap 0.9 / S01).

- New `@forge-cms/angular/server` subpath: `provideForgeCmsServer({ origin, forwardCookies?, forwardAuthorization? })`
  for the server render. Relative `baseUrl`/`authBaseUrl` resolve against the explicit `origin` (never the
  request's `Host`/`Forwarded` headers); identity is anonymous by default. Only the listed cookies of the
  **current** request are forwarded, and only to the configured origin; its `Authorization` header (opt-in)
  goes to that origin or `trustedOrigins`. Server requests never follow redirects. Read from Angular's standard `REQUEST`
  token inside each render's own injectors — no global request or user state.
- On a server platform, `CmsApiService` holds the render open while a request runs (`PendingTasks`) and aborts
  its in-flight requests when the render's application is destroyed. Without `provideForgeCmsServer`, a
  server render's relative request rejects with `ForgeApiError({ kind: 'network', code: 'SERVER_ORIGIN_REQUIRED' })`
  instead of reaching `fetch`; an absolute one never consults `location`. Combining `authToken` with visitor
  forwarding throws; a `credentials: 'omit'` client never receives forwarded cookies.
- `angularLinker()` (`@forge-cms/angular/vite`, re-exported by `@forge-cms/admin/vite`) now marks
  `@forge-cms/angular` and `@forge-cms/admin` as `ssr.noExternal`, so an SSR build links them too.

Browser behavior is unchanged: `provideForgeCms()` keeps its relative `/api/v1` and `/api/auth` defaults and
cookie credentials, and needs no server configuration. Hydration transfer is not part of this release.
