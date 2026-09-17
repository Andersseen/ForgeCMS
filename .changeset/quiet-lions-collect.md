---
'@forge-cms/cloudflare': minor
'@forge-cms/angular': minor
'@forge-cms/admin': minor
'@forge-cms/testing': minor
---

Add Forge Analytics (spec 057): an experimental, opt-in Cloudflare Analytics Engine integration.
`@forge-cms/cloudflare` gains `AnalyticsEngineWriter`/`NoopAnalyticsWriter` for writing pageviews and
`AnalyticsEngineQueryClient` for reading aggregated summaries via the Analytics Engine SQL API,
`@forge-cms/angular` gains a first-party pageview tracker (`provideForgeAnalytics`) and a query client
for the admin UI, `@forge-cms/admin` gains a reusable `ForgeAnalyticsDashboardComponent` and
`forgeAdminAnalyticsRoutes()`, and `@forge-cms/testing` gains `runAnalyticsWriterContractTests`.
Nothing is added to `DEFAULT_ADMIN_NAV` — every piece is opt-in and wired up only where an app chooses
to use it (see `apps/demo-aesthetics`).
