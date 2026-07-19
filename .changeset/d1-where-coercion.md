---
'@forge-cms/cloudflare': patch
---

Fix D1 `findMany` filters by coercing boolean/relation values with `toDbValue` before binding them to SQLite parameters.
