---
'@forge-cms/admin': patch
---

The collection form no longer submits the Forge-owned metadata (`id`, `created_at`, `updated_at`,
`_storageKey`) of the document it loaded. Saving therefore always gets a new `updated_at` from the
server. It also avoids a spurious `400` when another write changed the document's metadata after the
form loaded it (spec 063).
