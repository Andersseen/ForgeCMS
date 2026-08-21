---
'@forge-cms/core': minor
'@forge-cms/runtime': minor
---

feat: add Versions support for document history

- Add `versions` option to CollectionDefinition (boolean or { autosave: boolean })
- Add Version interface to core package
- Add versions.ts module with listVersions, getVersion, restoreVersion, createVersion
- Versions are automatically created on document create and update
- Add HTTP handlers: handleListVersions, handleGetVersion, handleRestoreVersion
- Add Local API methods to ForgeCmsRuntime
- Version tables are automatically created during syncSchema
- Versions store complete document snapshots with metadata (versionNumber, createdAt, createdBy, autosave, label)
- Support for manual version creation with custom labels
- Restore creates a new version with the restored data
