---
'@forge-cms/db': patch
---

`LibSqlDatabaseAdapter` now loads `@libsql/client` and `drizzle-orm/libsql` on its first database operation instead of when `@forge-cms/db` is imported (spec 081). Importing the package entry no longer makes Nitro, Vite or wrangler resolve libSQL's platform-specific native package, so an app that only uses `InMemoryDatabaseAdapter` (or D1) builds and serves without any libSQL packaging workaround. The exports and types are unchanged. One observable difference: `init()` no longer opens the database — a bad URL now surfaces as a rejection from the first operation. On Nitro's `node-server` preset, an app that really uses a `file:` libSQL database must keep its dependencies in `node_modules` (`nitro: { externals: { trace: false } }`); see the SSR guide.
