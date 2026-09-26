---
'@forge-cms/runtime': minor
---

**Security:** callers can no longer write Forge-owned document metadata (spec 063).

- **`_storageKey` belongs to the upload pipeline.** Before, anyone with update + delete access on one
  upload document could `PATCH { "_storageKey": "<another object's key>" }` and then delete the
  document, which deleted the **other** object from storage. Now `create`, `update`, `preview`,
  `restoreVersion`, `updateGlobalDocument` and every HTTP handler refuse `_storageKey`, whether or not
  `overrideAccess` is set. Only the multipart upload flow records it, through an internal path that is
  not exported.
- **Deletion only uses `_storageKey`.** Spec 051's fallback that derived the object key from `url` is
  removed, because `url` is an editable field and could point at another document's file. **Upgrade
  note:** deleting an upload document that has no `_storageKey` (created from JSON, or recorded before
  storage keys existed) no longer deletes any object; Forge logs a warning and the object must be
  removed by hand.
- **`id`, `created_at` and `updated_at`.**
  - A create containing `created_at`, `updated_at` or `_storageKey` returns
    `400 INVALID_INPUT` ("Field '<key>' is managed by Forge and cannot be written"), and nothing is
    written.
  - An update or preview may contain these keys only with their stored values. Those echoes are
    dropped (a `null` counts as not set), so clients that send back the whole document they read keep
    working, and the adapter now
    stamps a new `updated_at`. On libSQL/D1, a stale `updated_at` sent back this way used to overwrite
    the new stamp.
  - A caller-chosen `id` on create is refused over HTTP and with `overrideAccess: false`. Trusted Local
    API code can still pass a non-empty string `id` for seeds and imports.
- **Hooks.** `beforeValidate`/`beforeChange` hooks (collections and globals) may change content and
  `_status`, not these keys. A hook that changes one fails the operation with an internal error (500).
  Hooks no longer see a trusted create's explicit `id` or the upload key in `data`; both appear on the
  returned `doc`.
- `_status` stays writable on `drafts` collections and globals.
- `runtime.adapters.database` remains the raw layer outside every CMS check.
- No new exports.
