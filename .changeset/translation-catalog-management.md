---
'@forge-cms/runtime': minor
'@forge-cms/angular': minor
'@forge-cms/admin': minor
---

Add localization metadata propagation and locale support across describe/HTTP/client layers. `FieldDescription` now exposes `localized`, `CollectionDescription` exposes `locales`, HTTP handlers extract and forward `?locale=`, Angular `QueryOptions`/`FieldMeta`/`CollectionMeta` carry locale info, and `CmsApiService` methods accept locale. Admin `ForgeFieldControlComponent` renders locale tabs for localized fields. Admin nav gains a Translations icon.
