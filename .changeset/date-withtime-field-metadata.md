---
'@forge-cms/runtime': patch
'@forge-cms/angular': patch
---

Expose the existing `defineField.date({ withTime: true })` option in field metadata: `FieldDescription.withTime` (runtime `describeField`) and `FieldMeta.withTime` (Angular), so a client can render a date-time control for it. Additive and optional; the wire format is unchanged.
