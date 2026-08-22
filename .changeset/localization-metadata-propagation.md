---
'@forge-cms/runtime': patch
'@forge-cms/angular': patch
'@forge-cms/admin': patch
---

fix: propagate localization metadata through describe/HTTP/client/admin layers (spec 044)

`localized: true` on a field and `locales` on a collection (spec 0.3.4) never reached past the
runtime's internal validation/storage layer, so no HTTP consumer could discover which fields were
localized or which locales a collection supported.

- `packages/runtime`: `FieldDescription.localized`, `CollectionDescription.locales` in `describe.ts`;
  `?locale=` parsed and forwarded on all four HTTP verbs (`handleList`/`handleRead` already had it,
  this adds `handleCreate`/`handleUpdate`)
- `packages/angular`: `FieldMeta.localized`, `CollectionMeta.locales`, `QueryOptions.locale`, and a
  `locale` option on `getDocument`/`createDocument`/`updateDocument`
- `packages/admin`: `ForgeFieldControlComponent` renders a locale-tab picker for any `localized`
  field once the owning collection's `locales` are known; `ForgeCollectionFormComponent` gained a
  `locales` input to pass them down
