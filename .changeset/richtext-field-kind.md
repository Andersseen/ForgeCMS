---
'@forge-cms/core': minor
'@forge-cms/db': minor
---

Added a `richtext` field kind (spec 015): `defineField.richtext()` produces a field whose value is a
`RichTextContent` document — an array of `RichTextNode` (`{ type: string, text?: string, children?:
RichTextNode[], ...marks/extra }`). `validateField` validates the structure recursively (a string `type`
required, `text` must be a string when present, `children` must be an array of valid nodes when present)
without enforcing any fixed node-type vocabulary. Stored as JSON text by `LibSqlDatabaseAdapter`/
`D1DatabaseAdapter`, the same pattern as the existing `json` field kind. No dedicated `@forge-cms/admin`
editor widget yet — falls back to the generic field UI, same as any field kind without one.
