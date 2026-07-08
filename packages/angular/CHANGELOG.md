# @forge-cms/angular

## 0.1.0

### Minor Changes

- Add `ApiAuthError` (thrown by write methods on a `401` response) and `CmsApiService.login(email, password)`.

### Patch Changes

- fa38e92: `createDocument`/`updateDocument` now throw `ApiValidationError` (with a `details: ApiFieldError[]` array) when the server responds with per-field validation errors, instead of a generic `Error`. Parses the actual response shape the write routes return today (`{ statusMessage, data: { errors } }`, via h3's `createError`) rather than the `{ error, details }` shape documented in ARCHITECTURE.md, which doesn't match reality for these two routes.
- fa38e92: Add `FieldMeta` and `CollectionMeta.fieldDefinitions` (field kind, label, required, select options) so clients can render schema-driven UI (tables, forms) instead of just field names. Additive — existing `CollectionMeta.fields: string[]` is unchanged.
- `toApiError` now parses the `{ error: string, details?: ApiFieldError[] }` envelope ARCHITECTURE.md documents, since `apps/www`'s write routes now delegate to `@forge-cms/runtime`'s handlers (which have always produced this shape) instead of hand-rolling h3 error responses. Supersedes the shape described in the `api-validation-error` changeset, which matched the old (now-removed) route implementation.
