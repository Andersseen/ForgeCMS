---
'@forge-cms/core': minor
'@forge-cms/runtime': minor
---

Added lifecycle hooks and field/collection access control (spec 013).

- `@forge-cms/core`: `CollectionDefinition` gains `hooks: { beforeChange?, afterChange? }` (arrays of
  functions run in order) and `access: { read?, create?, update?, delete? }` (role-name arrays).
  `BaseFieldOptions` gains `access: { read?, write? }`.
- `@forge-cms/runtime`: new `hooks.ts` (`runBeforeChangeHooks`/`runAfterChangeHooks`, wired into
  `handleCreate`/`handleUpdate` — a throwing `beforeChange` hook returns `400`, a throwing `afterChange`
  hook is logged and does not fail the already-succeeded request) and `field-access.ts`
  (`filterReadableFields` applied to `handleList`/`handleRead` responses, `assertWritableFields` applied
  to `handleCreate`/`handleUpdate` request bodies, returning `403` on violation).
  `collection.access.<op>` overrides the handler's static `allowedRoles` for that operation when present;
  collections without `access` behave exactly as before this spec (spec 010's route-level RBAC unchanged).
