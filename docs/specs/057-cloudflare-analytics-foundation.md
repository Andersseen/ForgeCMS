# 057 — Cloudflare Analytics foundation

- **Status:** done <!-- The maintainer's implementation brief for this exact feature (scope, schema, privacy rules, package boundaries, non-goals) is the approval; this spec records it before code lands, per docs/SDD.md's "an explicit human instruction counts as approval." -->
- **Author:** agent draft
- **Date:** 2026-09-17
- **Branch:** feature/cloudflare-analytics-foundation
- **Affected packages/apps:** @forge-cms/cloudflare, @forge-cms/angular, @forge-cms/admin, @forge-cms/testing, apps/demo-aesthetics

## Context / Why

Small client sites built with ForgeCMS today have no way to see traffic without bolting on a separate
analytics SaaS (Umami, Plausible, GA). ROADMAP.md explicitly lists analytics as **not a pre-1.0
target**, and specs 052/055/056 all name "dashboard analytics" as a deliberate non-goal — this spec is
the maintainer choosing, out of that sequence, to prove one narrow vertical slice: Cloudflare Workers
Analytics Engine as the event store, queried server-side and rendered inside the existing admin shell.
It is explicitly experimental and does not change any pre-1.0 commitment. It must not touch `core`,
`runtime`'s adapter contracts, or the API envelope — analytics events are not CMS documents and never
go through `ForgeCmsRuntime`.

## Goal

Deploying `apps/demo-aesthetics` with an Analytics Engine binding configured lets an admin open
`/admin/analytics` and see real pageview counts, a timeline, top pages, referrer domains, and
countries for the site's public pages — with unauthorized requests rejected and a clear
"not configured" state when credentials are missing.

## Non-goals

- Not a standalone analytics product, not a new repository, not Umami/GA compatibility.
- No unique visitors, sessions, cookies, persistent identifiers, fingerprinting, or advertising IDs.
- No custom events, funnels, goals, conversions, heatmaps, session replay, Core Web Vitals, or JS
  error tracking.
- No device-category breakdown in this slice (reliable UA parsing needs a dependency or a data source
  this repo doesn't have yet — deferred, see Outcome/future work).
- No Cloudflare OAuth, customer-owned Cloudflare accounts, billing, multi-tenancy, or organizations.
- No generic plugin/extension framework — one opt-in nav icon and one opt-in routes helper only.
- No change to `packages/core`, `packages/db`, `packages/runtime`'s `AdapterSet`, or the API envelope.
  Analytics writes/reads never go through `ForgeCmsRuntime` — they use a Cloudflare binding and an
  external HTTP API directly, exactly like the demo's own `bookings.post.ts` bypasses generic CRUD for
  a public anonymous write.
- No D1 storage of pageviews, no queue/Durable Object/KV in the write path.
- No historical range beyond Analytics Engine's own 90-day retention.
- `apps/www` and `apps/tiny-project` are untouched — analytics is wired into `apps/demo-aesthetics`
  only, and `DEFAULT_ADMIN_NAV` is not changed (nav entry is app-local, opt-in, per the spec-044-revert
  lesson in STATE.md).

## Design

### 1. Analytics Engine schema (single source of truth)

New file `packages/cloudflare/src/analytics-schema.ts`. Every position is named here; nothing else in
the codebase hardcodes `blob2`/`double1`/etc.

```ts
export const ANALYTICS_SCHEMA = {
  index: { siteId: 1 },
  blob: { eventType: 1, pathname: 2, referrerHost: 3, country: 4, deviceCategory: 5 },
  double: { count: 1 }
} as const;

export const ANALYTICS_MAX_LENGTHS = {
  pathname: 256,
  referrerHost: 253,
  country: 2,
  siteId: 128
} as const;

export interface AnalyticsPageviewInput {
  siteId: string;
  pathname: string;
  /** Hostname only, `''` when none or same-origin. Never a full URL. */
  referrerHost: string;
  /** 2-letter ISO country code, `''` when unknown. */
  country: string;
}

export function sanitizePathname(raw: unknown): string;
export function sanitizeReferrerHost(raw: unknown, requestHost?: string): string;
export function sanitizeCountry(raw: unknown): string;
export function sanitizeSiteId(raw: unknown): string;

/**
 * Builds the exact `writeDataPoint()` argument from the schema above. Returns the shared
 * `AnalyticsEngineDataPoint` type (whose three fields are all optional, matching Cloudflare's real
 * binding shape) — this function itself always populates all three, but callers reading the return
 * value still see the wider optional type, not a narrower guarantee.
 */
export function toPageviewDataPoint(input: AnalyticsPageviewInput): AnalyticsEngineDataPoint;
```

Dataset layout (documented here and nowhere else):

```
index1  = site id (stable per-deployment identifier; low cardinality today, deliberately reserved
          for a future multi-site-per-dataset case where it would be genuinely high-cardinality)
blob1   = event type ("pageview" — reserved for future event types, none added in this slice)
blob2   = pathname (leading slash, no query/hash, capped at 256 chars)
blob3   = referrer host (hostname only, "" if none/same-origin, capped at 253 chars)
blob4   = country (2-letter ISO code from CF-IPCountry, "" if unknown/Tor/unassigned)
blob5   = device category (reserved, always "" this slice — not implemented)
double1 = count (always 1; lets future weighted aggregates use SUM(_sample_interval * double1))
```

`sanitizePathname`/`sanitizeReferrerHost`/`sanitizeCountry` are pure, framework-free functions so they
are unit-testable without a Worker or fetch mock, and are the only place query-string/hash stripping
and referrer-to-hostname reduction happen — the collector route calls them, nothing else does.

### 2. Write side — `@forge-cms/cloudflare`

`packages/cloudflare/src/bindings.ts` gains:

```ts
export interface AnalyticsEngineDataPoint {
  indexes?: string[];
  blobs?: string[];
  doubles?: number[];
}
export interface AnalyticsEngineDataset {
  writeDataPoint(event: AnalyticsEngineDataPoint): void;
}
```

`CloudflareEnv` gains `ANALYTICS?: AnalyticsEngineDataset`.

New `packages/cloudflare/src/analytics-writer.adapter.ts`, following the exact `D1DatabaseAdapter`/
`R2StorageAdapter` shape (constructor options + `init(env)`, configurable binding name):

```ts
export interface AnalyticsWriter {
  readonly name: string;
  init(env?: unknown): this;
  recordPageview(input: AnalyticsPageviewInput): void;
}

export interface AnalyticsEngineWriterOptions {
  /** Which binding on `env` holds the dataset. Defaults to `'ANALYTICS'`. */
  binding?: string;
}

export class AnalyticsEngineWriter implements AnalyticsWriter {
  readonly name = 'analytics-engine';
  constructor(options?: AnalyticsEngineWriterOptions);
  init(env: unknown): this; // throws `AnalyticsEngineWriter requires env.${binding} binding` if missing
  recordPageview(input: AnalyticsPageviewInput): void; // fire-and-forget, never awaited, matches Cloudflare's own writeDataPoint contract
}

/** Used when no ANALYTICS binding is configured — collection becomes a silent no-op, not a crash. */
export class NoopAnalyticsWriter implements AnalyticsWriter {
  readonly name = 'noop-analytics';
  init(): this;
  recordPageview(): void;
}
```

### 3. Read side — `@forge-cms/cloudflare`

Querying is an external HTTPS call (Cloudflare's Analytics Engine SQL API), not a binding, so it is a
plain class taking credentials, not an `init(env)`-style adapter:

```ts
export type AnalyticsDateRange = '24h' | '7d' | '30d' | '90d';
export const ANALYTICS_DATE_RANGES: readonly AnalyticsDateRange[];

export interface AnalyticsQueryClientOptions {
  accountId: string;
  apiToken: string;
  dataset: string;
  /** Injectable for tests; defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface AnalyticsSummaryResult {
  range: AnalyticsDateRange;
  totals: { pageviews: number; previousPageviews: number; changePct: number | null };
  timeline: { bucket: string; pageviews: number }[];
  topPages: { path: string; pageviews: number }[];
  referrers: { host: string; pageviews: number }[];
  countries: { country: string; pageviews: number }[];
}

// Also exported, for unit-testing the SQL strings directly without a fetch mock:
export function buildTimelineQuery(
  dataset: string,
  siteId: string,
  range: AnalyticsDateRange
): string;
export function buildPreviousTotalQuery(
  dataset: string,
  siteId: string,
  range: AnalyticsDateRange
): string;
export function buildTopPagesQuery(
  dataset: string,
  siteId: string,
  range: AnalyticsDateRange
): string;
export function buildReferrersQuery(
  dataset: string,
  siteId: string,
  range: AnalyticsDateRange
): string;
export function buildCountriesQuery(
  dataset: string,
  siteId: string,
  range: AnalyticsDateRange
): string;

export class AnalyticsEngineQueryClient {
  constructor(options: AnalyticsQueryClientOptions);
  getSummary(siteId: string, range: AnalyticsDateRange): Promise<AnalyticsSummaryResult>;
}
```

Endpoint: `POST https://api.cloudflare.com/client/v4/accounts/{accountId}/analytics_engine/sql`,
`Authorization: Bearer {apiToken}` (token needs Account → Account Analytics → Read), raw SQL as the
request body, JSON response `{ data: [...], rows: N }` (verified against current Cloudflare docs
2026-09-17).

`getSummary` runs exactly **5** bounded queries (not one per rendered widget — totals are derived
client-side by summing the timeline query's rows instead of a 6th query):

1. Timeline: `SELECT DATE_TRUNC('{hour|day}', timestamp) AS bucket, SUM(_sample_interval) AS pageviews FROM {dataset} WHERE index1='{siteId}' AND blob{eventType}='pageview' AND timestamp >= NOW() - INTERVAL '{n}' {UNIT} GROUP BY bucket ORDER BY bucket ASC`
2. Previous-period total: same WHERE shifted back one more window, single aggregate row.
3. Top pages: `GROUP BY blob{pathname} ... ORDER BY pageviews DESC LIMIT 10`
4. Referrers: `GROUP BY blob{referrerHost} ... LIMIT 10` (empty string mapped to `'Direct'` client-side)
5. Countries: `GROUP BY blob{country} ... LIMIT 10` (empty string mapped to `'Unknown'` client-side)

All five use `SUM(_sample_interval)` instead of `COUNT(*)` — verified against current Cloudflare docs:
`_sample_interval` is "how many original rows this row represents" and is only >1 once Analytics
Engine downsamples at high write volume; `COUNT(*)` alone would silently undercount once that happens.
Bucket granularity: `24h` → hour buckets; `7d`/`30d`/`90d` → day buckets. `siteId` is escaped
(`'` → `''`) before interpolation; `range` is only ever one of the 4 literal enum values, never raw
user SQL.

### 4. Public collector — `apps/demo-aesthetics`

`POST /api/analytics/collect`, a bespoke route (not through generic `/api/v1/*` CRUD, same reasoning
as `bookings.post.ts`: analytics events are not a collection and must stay reachable anonymously).

Request body (only these two fields accepted — everything else ignored, nothing is stored blindly):

```ts
{ pathname: string; referrer?: string }
```

Handler:

```
parse JSON (400 on malformed body)
  → sanitizePathname(body.pathname)
  → sanitizeReferrerHost(body.referrer, requestHostname)
  → sanitizeCountry(header('CF-IPCountry'))
  → siteId = sanitizeSiteId(env.FORGE_ANALYTICS_SITE_ID)
  → (env.ANALYTICS ? new AnalyticsEngineWriter() : new NoopAnalyticsWriter()).init(env).recordPageview(...)
  → 204 No Content
```

No IP, no email, no ForgeCMS user id is ever read or stored. `demo-guard.ts`'s 256 KB body cap still
applies, but its 12-writes/min/IP throttle does **not**: an early version left the collector subject
to it, and this app's own e2e suite caught real signup/login requests failing with `429` once the
tracker started firing a beacon on every page load in a browser session, because both shared the same
per-IP write budget. `demo-guard.ts` now exempts `/api/analytics/collect` from that specific check —
pageviews aren't a D1/R2 mutation and go to a separate, effectively-free Analytics Engine quota, so
they shouldn't compete with real content writes for the same budget.

### 5. Authenticated query endpoint — `apps/demo-aesthetics`

`GET /api/analytics/summary?range=7d`, admin-only (reuses `requireAdminAuth()` from
`apps/demo-aesthetics/src/server/api/auth-request.ts`, unchanged). `range` validated against
`ANALYTICS_DATE_RANGES`; anything else → 400.

```ts
// 200, configured:
{ data: { configured: true, ...AnalyticsSummaryResult } }
// 200, CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_ANALYTICS_TOKEN missing:
{ data: { configured: false } }
// 401/403 via requireAdminAuth(); 400 for a bad `range`
```

"Configured" means "the two SQL API credentials are set" — the `ANALYTICS` write binding is
irrelevant to the read path (querying is an unrelated HTTPS call) and is deliberately not checked
here. Deliberately 200 (not 500) when the credentials are unconfigured — this is an expected
deployment state the admin UI must render, not a server error. A separate, real failure mode exists
even with valid credentials: the dataset does not exist until its first write, and querying a
never-written dataset may itself error. That case is also mapped to a 200 — `{ data: { configured:
true, ...emptySummary } }` — since it's indistinguishable from "the credentials are right, there's
just no traffic yet," which is exactly the dashboard's existing empty state, not its error state.

### 6. Browser tracker — `@forge-cms/angular`

New `packages/angular/src/analytics.ts`:

```ts
export interface ForgeAnalyticsConfig {
  /** Defaults to `true`. */
  enabled?: boolean;
  /** Same-origin collector path. Defaults to `/api/analytics/collect`. */
  endpoint?: string;
}
export const FORGE_ANALYTICS_CONFIG: InjectionToken<ForgeAnalyticsConfig>;
export function provideForgeAnalytics(
  config?: ForgeAnalyticsConfig
): (Provider | EnvironmentProviders)[];
```

`provideForgeAnalytics` mirrors `provideForgeCms`'s "plain function → `Provider[]`" shape, plus one
`ENVIRONMENT_INITIALIZER` entry that eagerly injects the tracker service when `enabled !== false` —
this repo has no `APP_INITIALIZER` precedent, and `ENVIRONMENT_INITIALIZER` is the smaller, current
Angular idiom for "instantiate this singleton when the app boots."

New `packages/angular/src/analytics-tracker.service.ts`:

```ts
@Injectable({ providedIn: 'root' })
export class ForgeAnalyticsTracker {
  // constructor guarded by `typeof window !== 'undefined'` (matches SiteShell's existing idiom);
  // sends one pageview on construction, then subscribes to `Router.events` and sends on every
  // `NavigationEnd` whose `location.pathname` differs from the last one sent (dedupes redundant
  // NavigationEnd emissions and query-only navigations without a path change);
  // uses `navigator.sendBeacon(endpoint, blob)`, falling back to
  // `fetch(endpoint, { method: 'POST', keepalive: true, credentials: 'omit', body })` when
  // `sendBeacon` is unavailable or returns false. Never sends cookies (`credentials: 'omit'`) —
  // a pageview beacon is not an authenticated CmsApiService call.
}
```

No `rxjs` dependency added: `Router.events.subscribe(...)` is used directly (the `Observable` type
already flows in transitively through the `@angular/router` peer dependency).

New `packages/angular/src/analytics-api.service.ts` (the admin dashboard's read client):

```ts
@Injectable({ providedIn: 'root' })
export class ForgeAnalyticsApiService {
  // GET /api/analytics/summary?range=..., credentials: 'include'. Hardcoded, not baseUrl-relative —
  // same convention as CmsApiService.getCurrentUser() hardcoding /api/auth/me.
  getSummary(range: AnalyticsRange): Promise<AnalyticsSummaryResponse>;
}
export type AnalyticsRange = '24h' | '7d' | '30d' | '90d';
export interface AnalyticsSummaryResponse {
  configured: boolean; /* ...AnalyticsSummaryResult when configured */
}
```

A separate service from `CmsApiService` (not new methods bolted onto it): analytics reads are not CMS
CRUD, and this keeps `CmsApiService` unchanged.

### 7. Admin dashboard — `@forge-cms/admin`

`packages/admin/src/config.ts`: `ForgeAdminNavIcon` gains `'analytics'`. `packages/admin/src/
layout.component.ts` gains one more `@case ('analytics')` rendering the existing `LmnChartBarIcon`
(already imported; today only reachable via the `@default` fallback).

New `packages/admin/src/analytics-dashboard.component.ts` (`ForgeAnalyticsDashboardComponent`,
standalone, `OnPush`) — manual `loading`/`error`/`data`/`range` signals (this data isn't a
`CollectionMeta`/document, so `collectionResource`/`documentResource` don't fit; follows the same
`load()`-in-`ngOnInit` pattern as `ForgeCollectionsIndexComponent`). States:

- **loading**: `<forge-loading-state variant="stat-grid" />`
- **error**: `<forge-error-state ... (retry)="load()" />` via `describeAdminError`
- **not configured** (`data.configured === false`): a dedicated empty-state explaining analytics
  hasn't been set up for this deployment yet, distinct from "no traffic yet"
- **empty** (`configured: true`, `totals.pageviews === 0`): explains collection starts once the site
  gets traffic
- **success**: pageviews stat + `changePct`, a hand-rolled inline-SVG bar timeline (no chart library —
  none exists in this repo today and one row of bars doesn't justify adding one), top pages list,
  referrers list, countries list, and a native `<select>` for the 4 date ranges.

New `packages/admin/src/analytics-routes.ts`:

```ts
export function forgeAdminAnalyticsRoutes(): Routes; // [{ path: 'analytics', component: ForgeAnalyticsDashboardComponent }]
```

Same "host spreads this into their own `Routes`" shape as `forgeAdminContentRoutes()`. Nothing is
added to `DEFAULT_ADMIN_NAV` — a consuming app opts in by spreading `forgeAdminAnalyticsRoutes()` into
its admin children _and_ adding its own nav item, exactly as `apps/demo-aesthetics` already does for
every other nav entry.

### 8. Wiring — `apps/demo-aesthetics`

- `wrangler.toml`: `[[analytics_engine_datasets]]` with `binding = "ANALYTICS"`,
  `dataset = "forge_analytics_demo"` (created automatically on first write, per current Cloudflare
  docs — no manual dataset-creation step).
- `src/server/api/runtime.ts`'s `ServerEnv` gains `ANALYTICS?: AnalyticsEngineDataset` and
  `FORGE_ANALYTICS_SITE_ID?: string` (not wired into `ForgeCmsRuntime`'s `adapters` — read directly by
  the two new routes).
- `src/app/app.config.ts`: `provideForgeAnalytics({ enabled: true })` alongside `provideForgeCms(...)`.
- `src/app/app.routes.ts`: admin `children` gains `...forgeAdminAnalyticsRoutes()`; the app's own
  `nav` array gains one `{ label: 'Analytics', routerLink: '/admin/analytics', icon: 'analytics' }`
  item.
- New `.dev.vars.example` documenting `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_ANALYTICS_TOKEN` (query
  side only — the write side needs no secret, only the `ANALYTICS` binding).

## Implementation plan

- [x] `packages/cloudflare/src/bindings.ts` — add `AnalyticsEngineDataset`/`AnalyticsEngineDataPoint`, extend `CloudflareEnv`
- [x] `packages/cloudflare/src/analytics-schema.ts` — schema constants + sanitize functions + `toPageviewDataPoint` + tests
- [x] `packages/cloudflare/src/analytics-writer.adapter.ts` — `AnalyticsEngineWriter` + `NoopAnalyticsWriter` + tests
- [x] `packages/cloudflare/src/analytics-query.adapter.ts` — `AnalyticsEngineQueryClient` + query builders + tests
- [x] `packages/cloudflare/src/index.ts` — export all of the above
- [x] `packages/testing/src/contracts/analytics.ts` + barrel export — `runAnalyticsWriterContractTests`
- [x] `packages/angular/src/analytics.ts` (+ `analytics-config.ts` to avoid an import cycle) — config token + `provideForgeAnalytics`
- [x] `packages/angular/src/analytics-tracker.service.ts` + test
- [x] `packages/angular/src/analytics-api.service.ts` + test
- [x] `packages/angular/src/index.ts` — export the above
- [x] `packages/admin/src/config.ts` — `'analytics'` nav icon
- [x] `packages/admin/src/layout.component.ts` — icon `@case`
- [x] `packages/admin/src/analytics-dashboard.component.ts` + test (loading/error/not-configured/empty/success)
- [x] `packages/admin/src/analytics-routes.ts`
- [x] `packages/admin/src/index.ts` — export the above
- [x] `apps/demo-aesthetics/wrangler.toml` — `analytics_engine_datasets` binding
- [x] `apps/demo-aesthetics/src/server/api/runtime.ts` — `ServerEnv` fields
- [x] `apps/demo-aesthetics/src/server/routes/api/analytics/collect.post.ts`
- [x] `apps/demo-aesthetics/src/server/routes/api/analytics/summary.get.ts`
- [x] `apps/demo-aesthetics/src/app/app.config.ts` — `provideForgeAnalytics`
- [x] `apps/demo-aesthetics/src/app/app.routes.ts` — routes + nav entry
- [x] `apps/demo-aesthetics/src/server/middleware/demo-guard.ts` — exempt the collector from the
      per-IP write throttle (found by the app's own e2e suite — see Outcome)
- [x] `apps/demo-aesthetics/.dev.vars.example` + `.gitignore` entry
- [x] `packages/cloudflare/README.md` + `apps/demo-aesthetics/README.md` — consumer docs
- [x] changeset for `@forge-cms/cloudflare`, `@forge-cms/angular`, `@forge-cms/admin`, `@forge-cms/testing`
- [x] `docs/STATE.md` + `docs/ROADMAP.md` update; mark this spec `done`

## Test plan

- Unit (`packages/cloudflare`): sanitize functions (pathname query/hash stripping, referrer→hostname,
  country allow-list, length caps), `toPageviewDataPoint` position mapping, `AnalyticsEngineWriter`
  (missing-binding throw, `writeDataPoint` called with exact shape via a spy dataset),
  `NoopAnalyticsWriter` never throws, SQL query-builder string assertions (bucket unit, `SUM
(_sample_interval)`, `LIMIT`, siteId escaping), `AnalyticsEngineQueryClient.getSummary` against a
  fake `fetchImpl` (5 calls, correct endpoint/headers/body, correct result assembly incl. `changePct`
  math and the zero-previous-period → `null` case).
- Unit (`packages/angular`): tracker sends once on construction and again only on a `NavigationEnd`
  with a different pathname (no double-count on redundant events), uses `sendBeacon` when available
  and falls back to `fetch(..., { keepalive: true })` otherwise, never sends `credentials`.
  `ForgeAnalyticsApiService` against a faked `fetch`.
- Unit (`packages/admin`): dashboard component's loading/error/not-configured/empty/success branches
  against a faked `ForgeAnalyticsApiService`.
- Contract: `runAnalyticsWriterContractTests` run against `AnalyticsEngineWriter` in
  `packages/cloudflare/src/analytics-writer.adapter.test.ts`.
- Manual/deferred (documented, not run by this branch unless real credentials are available): deploy
  `apps/demo-aesthetics`, visit public pages, confirm `/admin/analytics` shows real pageviews.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format:check`.
- `apps/demo-aesthetics`'s Playwright e2e suite (auth, signup, public site, admin dashboard) — not
  analytics-specific, but the right regression signal for "did wiring the tracker into every page
  break anything else," and it did once (see Outcome).

## Acceptance criteria

1. `AnalyticsEngineWriter.init()` throws a named-binding error when `env.ANALYTICS` is absent, exactly
   like `D1DatabaseAdapter`/`R2StorageAdapter`.
2. `POST /api/analytics/collect` with `{ pathname: "/foo?x=1#y" }` writes a data point whose blob2 is
   `/foo` (query/hash stripped) and never persists an IP, email, or user id.
3. `GET /api/analytics/summary` returns 401/403 for a non-admin caller and never issues an outbound
   SQL API call in that case.
4. `GET /api/analytics/summary` returns `{ data: { configured: false } }` (200) when
   `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_ANALYTICS_TOKEN` are unset, not a 500.
5. `ForgeAnalyticsTracker` sends exactly one collector request for two consecutive `NavigationEnd`
   events with the same pathname.
6. `DEFAULT_ADMIN_NAV` is byte-for-byte unchanged; `apps/www` and `apps/tiny-project` compile and run
   with no analytics wiring at all.
7. `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format:check` all pass.

## Open questions

None — resolved during design (device category deferred; local Analytics Engine write emulation via
Miniflare is undocumented as of 2026-09-17 and is called out as a real-account-only verification step
in the Outcome section rather than blocking this spec).

## Outcome

Shipped as designed, with one real bug found and fixed along the way (see below). `pnpm lint &&
pnpm typecheck && pnpm test && pnpm build && pnpm format:check` are green at the repo root (14/14
Turbo tasks build, including `apps/www` and `apps/tiny-project`, both untouched), and
`apps/demo-aesthetics`'s full Playwright e2e suite (9 tests: auth, signup, public site, admin
dashboard) passes.

**Real bug found by the demo's own e2e suite, not assumed**: the first pass left the analytics
collector (`POST /api/analytics/collect`) subject to `demo-guard.ts`'s 12-writes/min/IP throttle,
the same budget shared by real content mutations. Once `provideForgeAnalytics` started firing a
beacon on every page load and SPA navigation, three e2e tests (`signup`, `logout`) began failing with
`429` instead of `201`/`200` — the tracker's own traffic was starving legitimate signup/login
requests during a normal test run. Fixed by exempting `/api/analytics/collect` specifically from the
write-count throttle (its body-size cap still applies) in `demo-guard.ts`, with the reasoning recorded
in that file and in this spec's Design §4. This was an app-level deployment guardrail, not a
`packages/*` gap, so it needed no `docs/DEMO-FINDINGS.md` entry.

**Independent review pass** (a rules-conformance review and a spec-conformance review, both against
the full uncommitted diff) surfaced five more real issues, all fixed before this spec was marked done:

1. **The `'24h'` range queried 1 hour, not 24** (`RANGE_CONFIG['24h']` had `amount: 1` instead of
   `amount: 24`) — every "Last 24 hours" dashboard load silently showed a 1-hour window instead,
   with no test catching it. Fixed, and a regression test added
   (`analytics-query.adapter.test.ts`'s `"queries a full 24-hour window..."` case).
2. **`POST /api/analytics/collect` 500'd on an empty or literal-`null` JSON body** — h3's `readBody`
   returns `undefined`/`null` for those cases without throwing, so `body.pathname` threw a
   `TypeError` the route's `try/catch` never caught (it only covers actual JSON parse errors). Real
   impact: an unauthenticated, throttle-exempt endpoint returning unhandled 500s to a trivially
   craftable request. Fixed by normalizing a non-object parse result to `{}` before reading it.
3. **The admin analytics dashboard was bundled into the public marketing site's entry chunk** —
   `forgeAdminAnalyticsRoutes()` used an eager `component:` route (matching `forgeAdminContentRoutes()`'s
   existing pattern), which is safe in `apps/www`/`apps/tiny-project` only because they isolate their
   whole admin subtree behind a second `loadChildren` boundary; `apps/demo-aesthetics` builds its admin
   children directly inside its eagerly-loaded root `app.routes.ts`, so every anonymous visitor was
   downloading the analytics dashboard and its `VoltCard`/state-component dependencies. Fixed by making
   `forgeAdminAnalyticsRoutes()` itself `loadComponent`-based; verified by rebuilding and confirming
   `forge-analytics-dashboard` no longer appears in the entry chunk (it now has its own ~6 KB chunk, and
   the entry chunk shrank by ~175 KB).
4. `sanitizeSiteId` accepted arbitrary characters (only length-capped, not charset-restricted), and
   `escapeLiteral` didn't escape backslashes — neither was reachable from HTTP today (`siteId` only
   ever comes from a trusted env var), but both are exported/public. Tightened `sanitizeSiteId` to a
   safe identifier charset and `escapeLiteral` to also escape `\`, defense in depth for future callers.
5. `provideForgeAnalytics` used the now-deprecated `ENVIRONMENT_INITIALIZER` token; switched to
   `provideEnvironmentInitializer` (confirmed current in the pinned `@angular/core@21.2.10` typings).

Also corrected as part of the same pass: the tracker now sends `referrer` only on a session's first
pageview (it was being resent unchanged on every SPA navigation, which would have inflated referrer
counts by page-depth); `summary.get.ts` now catches a failed SQL API call and treats it as "no traffic
yet" rather than a raw error, since a dataset with zero writes may not exist to query yet; and several
doc/comment inaccuracies the reviews caught (a stale "never sends cookies" claim that was only true of
the `fetch` fallback, not the primary `sendBeacon` path; a misleading "never throws" comment; an
overstated docs cross-reference) were fixed inline. Design §§1, 5, 6 above reflect the corrected
behavior, not the original draft.

**Not verified**: a real deployed Cloudflare Analytics Engine dataset. No Cloudflare account
credentials were available in this environment, so:

- The write path (`AnalyticsEngineWriter`) is verified only against a hand-rolled spy binding in unit
  tests, following this package's own established convention (same as `D1DatabaseAdapter`/
  `R2StorageAdapter`'s unit tests) — not against a real or Miniflare-simulated Analytics Engine
  binding. Whether `wrangler dev`/Miniflare locally emulates `writeDataPoint()` is undocumented as of
  2026-09-17 (Cloudflare's own docs do not say either way) and was left unresolved rather than guessed.
- The read path (`AnalyticsEngineQueryClient`) is verified only against a faked `fetch`, exercising the
  exact SQL strings and response parsing — never a real SQL API round trip.

**Manual smoke-test steps for after a real deploy** (none of these were run by this branch):

1. `pnpm exec wrangler deploy` (or the existing `deploy:demo` script) with `apps/demo-aesthetics`'s
   `wrangler.toml` as-is — the `ANALYTICS` binding needs no pre-provisioning.
2. Set `CLOUDFLARE_ACCOUNT_ID` and a `CLOUDFLARE_ANALYTICS_TOKEN` (Account → Account Analytics → Read)
   as Pages secrets.
3. Visit a few public pages and navigate between them (client-side) to generate pageviews.
4. Wait roughly 30–60 seconds (Analytics Engine write-to-query latency), then open `/admin/analytics`
   signed in as the demo admin and confirm the pageview count, timeline, top pages, and referrers
   reflect the real visits.
5. Temporarily unset either Cloudflare secret and reload `/admin/analytics` to confirm it falls back to
   the "not configured" empty state instead of erroring.

No divergence from the Design section beyond the `demo-guard.ts` fix above and the two small
documentation corrections noted inline (the `ForgeAnalyticsApiService` endpoint description, and
`apps/demo-aesthetics/README.md`'s stale e2e-suite claim, both unrelated to this feature's own logic).
