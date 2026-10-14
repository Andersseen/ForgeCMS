---
name: forgecms-analytics
description: EXPERIMENTAL - add Forge Analytics (Cloudflare Analytics Engine pageviews with an admin dashboard) to a client project from one verified recipe.
---

# Forge Analytics (EXPERIMENTAL)

Public but **experimental**: it is outside the stable 1.x compatibility promise, Cloudflare-only, and may change in any release. The complete guide is the `analytics` doc (`forge_docs_search "analytics"`); the recipe is verified by the repository against executable source.

## Pieces

1. **Client (tracker):** `provideForgeAnalytics({ enabled: true })` from `@forge-cms/angular` in the app config.
2. **Collector:** public `POST /api/analytics/collect`. It accepts only `pathname` and `referrer` from the body. Country comes from the `cf-ipcountry` request header; the site id comes from server configuration (`FORGE_ANALYTICS_SITE_ID`).
3. **Write:** `wrangler.toml` binds an Analytics Engine dataset as `ANALYTICS`. Use `AnalyticsEngineWriter` when the binding exists and `NoopAnalyticsWriter` when it does not (a missing binding must no-op, not crash). Build the fields with `sanitizePathname`, `sanitizeReferrerHost`, `sanitizeCountry`, `sanitizeSiteId` from `@forge-cms/cloudflare`.
4. **Read:** an **admin-only** `GET /api/analytics/summary?range=24h|7d|30d|90d` using `AnalyticsEngineQueryClient({ accountId, apiToken, dataset })`. Secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_ANALYTICS_TOKEN` (token scope: Account Analytics: Read) are server-only. Without them return `{ data: { configured: false } }`.
5. **Admin:** spread `...forgeAdminAnalyticsRoutes()` into the admin routes and add a navigation item (`routerLink: '<mount>/analytics'`). The dashboard shows pageviews, change vs the previous period, a timeline, top pages, referrers and countries, and handles `configured: false`, no traffic, loading and errors.

## Privacy contract (do not weaken)

Never collect or store: IP address, email, Forge user id, cookies, any persistent visitor identifier, raw query strings or hash, or the raw referrer URL (only the referrer **host**). No unique-visitor fingerprinting. Analytics is a site capability, separate from developer-tool telemetry (the agent kit collects none).

## Limits

No unique visitors, funnels, events, sessions, revenue or heatmaps. Retention is Analytics Engine's own 90 days. Cloudflare-only today. Do not add dependencies or collect extra fields to "improve" it.
