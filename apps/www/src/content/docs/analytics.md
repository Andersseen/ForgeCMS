---
title: Analytics (experimental)
description: Add privacy-minimizing pageview analytics and an admin dashboard on Cloudflare Analytics Engine - one verified recipe for a client project.
group: Client & deploy
order: 7
---

> **Experimental.** Forge Analytics is public but outside the stable 1.x compatibility promise: its interfaces may change in any release, it only has a Cloudflare implementation, and it is
> deliberately small. It is an opt-in site capability, never part of the runtime, the Local API or the REST envelope.

A client who opens the admin can see **pageviews**, the **change against the previous period**, a **timeline**, **top pages**, **referrers** and **countries** for the last 24 hours, 7, 30 or 90 days.

The server files below are embedded from `apps/demo-aesthetics`, where they are covered by tests (`pnpm test:demo`): the collector's privacy, the missing-binding no-op, `configured: false`, an invalid range, and
an empty dataset. Copy them as they are; only the dataset name and the auth check are yours.

## What is and is not collected

| Collected (per pageview)                             | Never collected                              |
| ---------------------------------------------------- | -------------------------------------------- |
| path, with the query string and hash removed         | IP address, email, Forge user id             |
| referrer **host** only (same-site referrers dropped) | cookies or any persistent visitor identifier |
| country from Cloudflare's `CF-IPCountry` header      | the raw referrer URL, the raw query string   |
| a site id from server configuration                  | any other field of the request body          |

There are no unique visitors: counting them would need an identifier, which Forge deliberately does not create. Retention is Analytics Engine's own 90 days.

## 1. Bind the dataset

```toml
# wrangler.toml
[[analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "my_site_analytics"
```

The dataset is created on the first write. Without the binding the collector does nothing (it never fails the request).

## 2. The collector (public)

<!-- snippet: apps/demo-aesthetics/src/server/analytics/collect.ts -->

```ts
import {
  AnalyticsEngineWriter,
  NoopAnalyticsWriter,
  sanitizeCountry,
  sanitizePathname,
  sanitizeReferrerHost,
  sanitizeSiteId,
  type AnalyticsEngineDataset
} from '@forge-cms/cloudflare';

/** The bindings and variables the collector reads. `ANALYTICS` is optional on purpose: no binding, no-op. */
export interface AnalyticsCollectEnv {
  ANALYTICS?: AnalyticsEngineDataset;
  FORGE_ANALYTICS_SITE_ID?: string;
}

export interface CollectPageviewInput {
  /** The parsed JSON body, whatever it is. Only `pathname` and `referrer` are ever read from it. */
  body: unknown;
  env: AnalyticsCollectEnv | undefined;
  /** Host of the request itself, so same-site referrers are dropped. */
  requestHost: string;
  /** The `CF-IPCountry` request header. */
  countryHeader: string | undefined;
}

/**
 * Records one pageview. Everything but `pathname`/`referrer` is derived on the server: the country from
 * Cloudflare's header, the site id from configuration. No IP, email, user id, cookie, visitor id,
 * query string or hash is read or stored.
 */
export function collectPageview(input: CollectPageviewInput): void {
  const body = (typeof input.body === 'object' && input.body !== null ? input.body : {}) as {
    pathname?: unknown;
    referrer?: unknown;
  };
  const env = input.env;
  const writer = env?.ANALYTICS
    ? new AnalyticsEngineWriter().init({ ANALYTICS: env.ANALYTICS })
    : new NoopAnalyticsWriter();

  writer.recordPageview({
    siteId: sanitizeSiteId(env?.FORGE_ANALYTICS_SITE_ID),
    pathname: sanitizePathname(body.pathname),
    referrerHost: sanitizeReferrerHost(body.referrer, input.requestHost),
    country: sanitizeCountry(input.countryHeader)
  });
}
```

Expose it as a **public** route (`POST /api/analytics/collect`, answering `204`). The h3 wrapper reads the JSON body, `getRequestURL(event).hostname` and the `cf-ipcountry` header and calls `collectPageview`; see `apps/demo-aesthetics/src/server/routes/api/analytics/collect.post.ts`.

## 3. The admin summary (admin only)

Querying uses Cloudflare's Analytics Engine **SQL API**, an HTTPS call that needs two server-only secrets. Set them with `wrangler pages secret put` and never commit them:

```bash
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_ANALYTICS_TOKEN=...   # API token scoped to Account > Account Analytics > Read
```

<!-- snippet: apps/demo-aesthetics/src/server/analytics/summary.ts -->

```ts
import {
  ANALYTICS_DATE_RANGES,
  AnalyticsEngineQueryClient,
  sanitizeSiteId,
  type AnalyticsDateRange,
  type AnalyticsSummaryResult
} from '@forge-cms/cloudflare';

/** Must match the `dataset` declared for the `ANALYTICS` binding in wrangler.toml. */
export const ANALYTICS_DATASET = 'forge_analytics_demo';

export interface AnalyticsSummaryEnv {
  FORGE_ANALYTICS_SITE_ID?: string;
  /** Server-only secrets for the Analytics Engine SQL API (query side only; writes need none). */
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_ANALYTICS_TOKEN?: string;
}

export type AnalyticsSummaryResponse =
  | { status: 400; message: string }
  | { status: 200; data: { configured: false } }
  | { status: 200; data: { configured: true } & Omit<AnalyticsSummaryResult, never> };

const EMPTY_SUMMARY: Omit<AnalyticsSummaryResult, 'range'> = {
  totals: { pageviews: 0, previousPageviews: 0, changePct: null },
  timeline: [],
  topPages: [],
  referrers: [],
  countries: []
};

interface QueryClientLike {
  getSummary(siteId: string, range: AnalyticsDateRange): Promise<AnalyticsSummaryResult>;
}

export interface GetAnalyticsSummaryInput {
  /** The raw `range` query value. */
  range: unknown;
  env: AnalyticsSummaryEnv | undefined;
  /** Test seam; defaults to the real Analytics Engine SQL API client. */
  createClient?: (options: {
    accountId: string;
    apiToken: string;
    dataset: string;
  }) => QueryClientLike;
}

function isValidRange(value: unknown): value is AnalyticsDateRange {
  return typeof value === 'string' && (ANALYTICS_DATE_RANGES as string[]).includes(value);
}

/**
 * The admin summary. The CALLER must have verified the user is an admin before calling this; the SQL API
 * must never be reachable for an unauthenticated request.
 */
export async function getAnalyticsSummary(
  input: GetAnalyticsSummaryInput
): Promise<AnalyticsSummaryResponse> {
  if (!isValidRange(input.range)) return { status: 400, message: 'Invalid or missing range' };

  const accountId = input.env?.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = input.env?.CLOUDFLARE_ANALYTICS_TOKEN;
  if (!accountId || !apiToken) return { status: 200, data: { configured: false } };

  const create = input.createClient ?? ((options) => new AnalyticsEngineQueryClient(options));
  const client = create({ accountId, apiToken, dataset: ANALYTICS_DATASET });
  try {
    const summary = await client.getSummary(
      sanitizeSiteId(input.env?.FORGE_ANALYTICS_SITE_ID),
      input.range
    );
    return { status: 200, data: { configured: true, ...summary } };
  } catch {
    // Valid credentials but the query failed - most likely the dataset has never been written to yet
    // (Analytics Engine creates it on the first write). That is "no traffic yet", not a server error.
    return { status: 200, data: { configured: true, ...EMPTY_SUMMARY, range: input.range } };
  }
}
```

Expose it as `GET /api/analytics/summary?range=24h|7d|30d|90d`, **after** your admin check (the demo calls `requireAdminAuth(event)` first and answers `400` for an invalid range). An unauthenticated or non-admin caller must never reach the SQL API. Without the two secrets the response is `{ data: { configured: false } }` and the dashboard shows a "not configured" state.

## 4. The tracker (browser)

```ts
import { provideForgeAnalytics, provideForgeCms } from '@forge-cms/angular';

providers: [
  provideForgeCms({ baseUrl: '/api/v1', authBaseUrl: '/api/auth', credentials: 'include' }),
  provideForgeAnalytics({ enabled: true }) // posts the pathname and referrer to /api/analytics/collect on navigation
];
```

`endpoint` can point at a different same-origin collector. Only the page path and the browser's referrer are sent.

## 5. The admin dashboard

```ts
import { forgeAdminAnalyticsRoutes } from '@forge-cms/admin';

// inside the layout route's children, next to forgeAdminContentRoutes():
...forgeAdminAnalyticsRoutes(),
```

Add a navigation item to the layout config: `{ label: 'Analytics', routerLink: '/admin/analytics', icon: 'analytics', exact: true }` (use your mount, for example `/studio/analytics`). The route is lazy, so the dashboard code is not part of the public initial bundle.

The dashboard handles loading, an error with retry, "not configured" (`configured: false`), "no traffic yet", and range changes; a positive or negative change against the previous period is shown with its sign.

## Limits

- Experimental; Cloudflare Analytics Engine only; 90 days retention; no unique visitors, funnels, events, sessions, revenue or heatmaps.
- Writes are fire-and-forget; counts are what Analytics Engine reports (sampled at very high volume).
- This is a site capability. The ForgeCMS developer tooling (`@forge-cms/agent`) collects no telemetry of any kind.
