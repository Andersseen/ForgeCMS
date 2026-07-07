---
'@forge-cms/angular': patch
---

`createDocument`/`updateDocument` now throw `ApiValidationError` (with a `details: ApiFieldError[]` array) when the server responds with per-field validation errors, instead of a generic `Error`. Parses the actual response shape the write routes return today (`{ statusMessage, data: { errors } }`, via h3's `createError`) rather than the `{ error, details }` shape documented in ARCHITECTURE.md, which doesn't match reality for these two routes.
