---
'@forge-cms/core': patch
---

Clarify the `Version` type's docs: `versionNumber` is unique per document (not guaranteed gapless), and
`data` is the full restorable content for automatic snapshots since spec 062, the changed fields only for
older snapshots, and exactly the given data for a manual `createVersion()`.
