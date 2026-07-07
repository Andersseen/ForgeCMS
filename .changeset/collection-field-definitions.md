---
'@forge-cms/angular': patch
---

Add `FieldMeta` and `CollectionMeta.fieldDefinitions` (field kind, label, required, select options) so clients can render schema-driven UI (tables, forms) instead of just field names. Additive — existing `CollectionMeta.fields: string[]` is unchanged.
