---
'@forge-cms/core': minor
'@forge-cms/runtime': minor
'@forge-cms/angular': minor
---

feat: add Live Preview support

- Add `preview()` method to ForgeCmsRuntime Local API
- Add `handlePreview` HTTP handler for preview endpoint
- Add `previewDocument()` method to Angular client
- Preview merges stored document data with unsaved changes
- Supports previewing new documents (no id) or existing documents (with id)
- Applies field defaults and auto-slug generation
- Supports relation population with depth parameter
- Useful for live preview in admin UI before saving
- Add 7 tests covering preview functionality
