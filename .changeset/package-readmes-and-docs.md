---
'@forge-cms/core': patch
'@forge-cms/db': patch
'@forge-cms/auth': patch
'@forge-cms/storage': patch
'@forge-cms/s3': patch
'@forge-cms/api': patch
'@forge-cms/runtime': patch
'@forge-cms/cloudflare': patch
'@forge-cms/angular': patch
'@forge-cms/admin': patch
'@forge-cms/testing': patch
---

Documentation only (roadmap 0.12 / R04, spec 091): the README shipped in every package now describes what the package is, who needs it, its stable entry points, its server/browser boundary and its support status.
`@forge-cms/api`, `runtime`, `auth`, `storage`, `core` and `testing` no longer say the implemented CRUD runtime, request handling, authentication and storage are future work. No code, export, option or default changed.
