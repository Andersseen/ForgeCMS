---
'@forge-cms/admin': minor
---

Reusable admin mounts anywhere, and the 1.0 admin surface is reviewed (spec 087, roadmap 0.11 / U03). Adds `ForgeAdminConfig.basePath` and `forgeAdminAuthRoutes({ basePath })` — a same-app mount root such as `/studio` or `/ops/cms` (default `/admin`, unchanged for existing hosts) that roots the layout's breadcrumbs, default navigation and default sign-in path, and bounds the sign-in/sign-up return target (`/admin/...`, `/studio-evil`, `//host` and URLs are refused). Route `data.config` now also reaches `ForgeCollectionsIndexComponent` (previously only the layout saw it). `ForgeAdminConfig.collections` is typed `ReadonlyArray<{ slug }>` so browser apps need not import server schema; `logo` and `features` are marked deprecated no-ops.

**Behaviour change (why this is a minor):** `DEFAULT_ADMIN_NAV` now lists only what the package mounts — Collections and the admin-only Users — instead of also linking Dashboard, Media Library, API and Settings pages the package never provided. A host that relied on the old defaults must list those entries in `nav`. An inline `collections: [{ slug, …extra }]` literal with extra keys no longer type-checks (pass slugs, or a variable). Migration notes: `docs/1.0-PUBLIC-SURFACE.md`.
