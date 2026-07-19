---
'@forge-cms/admin': minor
'@forge-cms/angular': minor
---

Refactor collection metadata: remove redundant `CollectionMeta.fields` and add `relation` metadata to `FieldMeta`. The admin form now renders `relation` fields and uses a native select for `select` fields.
