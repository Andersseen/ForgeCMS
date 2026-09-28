---
'@forge-cms/core': minor
'@forge-cms/db': minor
'@forge-cms/cloudflare': minor
'@forge-cms/runtime': minor
'@forge-cms/testing': minor
---

Globals and localization now behave as documented (spec 066, roadmap D04 part 1).

- **Global access queries are enforced.** An `access.read`/`access.update` rule that returns a query
  (e.g. `{ region: 'eu' }`) used to be treated as "allowed". Now a read of a row the query does not
  match returns `null` (HTTP `404`, as for an unconfigured global). An update needs the stored row to
  match (`403`), and such a rule can no longer authorize the first write, because there is no row to
  match yet.
- **Global writes after the first are partial**, like a collection `update()`:
  - omitted fields keep their stored values;
  - `defaultValue`s and the draft status apply only to the first write (before, a write without
    `_status` put a published global back to draft, and defaulted fields were reset);
  - validation runs on the merged document, so a required field no longer has to be re-sent;
  - `beforeValidate` hooks receive `previousData`;
  - `slug` fields with `autoGenerate` are generated.
- **Simultaneous first writes to a global:** exactly one commits. The other gets `409
CONCURRENT_MODIFICATION` instead of an internal unique-constraint error that named the
  `_global_<slug>` table.
- **Localized globals.** `defineGlobal({ locales: [...] })`, plus `locale` on
  `getGlobalDocument`/`updateGlobalDocument` and `?locale=` on the global HTTP routes. Writing one
  locale keeps the others. Two simultaneous per-locale edits (each written with `locale`) cannot silently drop one: the
  second gets a `409`. An undeclared locale is a `400`.
- **Localization works on libSQL and D1.** A `localized` field's per-locale map was bound as a plain
  column value, so every write failed on SQL adapters. It is now stored as JSON in a TEXT column (new
  `encodeFieldValue`/`decodeFieldValue` in `@forge-cms/db`, used by both SQL adapters).
- **Refused at startup** instead of accepted and broken:
  - a localized field with no `locales` declared;
  - a localized field of a kind other than `text`/`textarea`;
  - a localized field nested in `group`/`array`/`blocks`;
  - `access.create`/`access.delete` or delete hooks on a global.
- `InMemoryDatabaseAdapter` (and the D1 unit-test mock) now reject a second row with an existing `id`
  as a unique conflict, as libSQL and D1 always did.
- `@forge-cms/testing/contracts`: `runGlobalLifecycleContractTests` and `globalLifecycleGlobals`, a
  two-writer contract (run on InMemory, on-disk libSQL and local D1). The DatabaseAdapter contract adds
  a localized round-trip and a duplicate-id case.
