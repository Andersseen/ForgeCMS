---
'@forge-cms/runtime': patch
'@forge-cms/db': patch
'@forge-cms/cloudflare': patch
'@forge-cms/testing': patch
---

Fixes found by measuring reliability (roadmap 0.12 / R02, spec 089):

- `@forge-cms/db`, `@forge-cms/cloudflare`: a page request with an `offset` and no `limit` — `GET /api/v1/<collection>?offset=N`, or `find({ offset })` — failed with a SQL syntax error on the libSQL and D1 adapters (SQLite rejects `OFFSET` without `LIMIT`) while the in-memory adapter served it. Both adapters now page correctly; the shared query contract covers it for every adapter.
- `@forge-cms/runtime`: relation population looked up every distinct target of a page in ONE `id in (…)`. Cloudflare D1 allows 100 bound parameters per statement, so a depth-1 page referencing more than 100 distinct targets (50 rows × 3 tags from 150 tags) failed with "too many SQL variables" (a 500). Lookups are now chunked at 80 distinct ids per statement: database calls grow with the number of distinct targets, never with the number of rows.
- `@forge-cms/runtime`: an unexpected dependency failure in an HTTP handler, or a failed storage cleanup, no longer logs the original error object or message. A database driver or storage SDK error can quote a connection string, key id or token; the log now carries the error's class name and short machine code only (as the auth handlers already did, spec 069). HTTP responses were already generic.
- `@forge-cms/testing`: contract helpers shared by the concurrency suites are now unit-tested, and the winner-dependent assertions are index-based. No change to what the contracts assert.
