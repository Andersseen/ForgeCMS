---
'@forge-cms/runtime': minor
---

Added relation population (spec 012): `GET /api/v1/[collection]` and `GET /api/v1/[collection]/[id]`
accept `?depth=1`, which replaces each `relation` field's id (or array of ids) with the actual related
record(s) instead of the bare id. Dangling single relations become `null`; dangling entries inside `many`
relations are silently dropped. New `populateRecord`/`populateRecords` exports in `@forge-cms/runtime`,
built on spec 011's `in` operator — one batched `findMany` call per relation field per request, not one
per record. `depth` only accepts `0` (default) or `1`; any other value returns `400`.
