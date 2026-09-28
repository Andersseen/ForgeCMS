---
'@forge-cms/runtime': minor
'@forge-cms/testing': minor
---

Writes honour access consistently (spec 068).

- **Write responses respect read access.** A create, update or delete run with
  `overrideAccess: false` returns only `{ id }` when the caller may not read the result: the read rule
  denies it, its query does not match, or it is a draft they cannot see. Before, the full document came
  back.
  - An access-checked `delete()` returned the raw stored row, including read-denied fields.
  - A global update returned a global its read rule hid.
  - Readable results are unchanged: they go through the normal read preparation, so read-denied
    fields are removed. Trusted calls and the HTTP envelope (`{ data }`) are unchanged.
- **Update/delete access queries hold at the write.** A query-returning `update`/`delete` rule (and a
  global's `update` rule) is now also part of the write's own condition (`updateIf`/`deleteIf`
  `targetMatches`), for plain, versioned and cascading writes. A document moved out of the caller's
  scope between the access check and the write is a `409 CONCURRENT_MODIFICATION`, with nothing
  written. Before, the write applied.
- `@forge-cms/testing/contracts`: `runWriteAccessContractTests`, `writeAccessSchema` and
  `createWriteHold` (hold one database's next write, whatever primitive it uses).
