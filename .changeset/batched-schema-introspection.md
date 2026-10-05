---
'@forge-cms/db': patch
---

Schema planning (`syncSchema()` / `planSchema()` on the SQLite adapters, including D1) now reads every
table's columns and indexes in three queries in total instead of `2 + indexes` per table. On D1 each
query is a network round trip on every cold start; a ~10-collection site issued ~100 of them, which took
more than 10 seconds from a Cloudflare colo far from the database. No behavior or API change.
