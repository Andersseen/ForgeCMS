---
'@forge-cms/core': minor
'@forge-cms/runtime': minor
'@forge-cms/angular': minor
---

feat: add Globals support (singleton documents)

- Add `GlobalDefinition` type and `defineGlobal()` DSL in `@forge-cms/core`
- Add `getGlobalDocument()` and `updateGlobalDocument()` Local API methods
- Add HTTP handlers `handleGlobalRead()` and `handleGlobalUpdate()`
- Add `getGlobal()` and `updateGlobal()` methods to Angular client
- Add `GlobalMeta` type to Angular client
- Add `describeGlobal()` and `describeGlobals()` for admin UI metadata
- Globals are stored in `_global_<slug>` tables with a single `global` id
- Support for drafts, access control, hooks, and field validation
- Add example global `site_settings` to `apps/www`
- Add HTTP routes `/api/v1/globals/[global]` (GET/PUT)
