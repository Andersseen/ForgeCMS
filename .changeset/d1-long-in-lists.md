---
'@forge-cms/cloudflare': patch
'@forge-cms/testing': patch
---

`@forge-cms/cloudflare`: an `in` filter with 100 or more values — ordinary public input such as `GET /api/v1/<collection>?id[in]=a,b,…` — returned a 500 on the D1 profile, because D1 allows 100 bound parameters per statement (the in-memory and libSQL adapters served it). Lists longer than 50 values now travel as one JSON parameter (`IN (SELECT value FROM json_each(?))`) with the same set semantics; shorter lists are bound exactly as before. `@forge-cms/testing`: the shared database contract now covers a 300-value `in` list for every adapter. No public API change.
