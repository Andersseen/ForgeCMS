# Matrices — fields, capabilities and deployment profiles

Three tables, each answering "what exactly is supported, and how well is it proven?". Status words: **stable 1.0** (inside the compatibility promise, covered by tests/gates),
**experimental** (public, outside the promise), **intentionally limited** (works within a stated bound; the bound is part of the design — see [LIMITATIONS.md](LIMITATIONS.md)).
Version ranges and tested tuples are in [SUPPORT.md](SUPPORT.md).

## Field support matrix

The 15 field kinds. "Admin editor" is what `@forge-cms/admin` renders; "List" is the collection table cell.

| Kind       | Schema options (besides the base ones)         | Validation                                                                          | Admin editor                                                                            | List cell             | Localizable | Relation / notes                                                          |
| ---------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------- | ----------- | ------------------------------------------------------------------------- |
| `text`     | `minLength`, `maxLength`                       | string, length bounds                                                               | text input                                                                              | text                  | yes         | Filterable/sortable (not when localized)                                  |
| `textarea` | as `text`                                      | string                                                                              | multi-line input                                                                        | truncated, muted      | yes         | —                                                                         |
| `number`   | `min`, `max`                                   | finite number, bounds                                                               | number input                                                                            | text                  | no          | —                                                                         |
| `boolean`  | —                                              | boolean                                                                             | checkbox                                                                                | Yes / No              | no          | —                                                                         |
| `date`     | `withTime`                                     | any value `Date` parses; stored as canonical ISO string                             | native date input; `withTime` → `datetime-local`                                        | locale date           | no          | See the date notes below                                                  |
| `email`    | —                                              | string with email format                                                            | email input                                                                             | text                  | no          | —                                                                         |
| `select`   | `options`                                      | value must be one of `options`                                                      | native select                                                                           | text                  | no          | —                                                                         |
| `slug`     | `autoGenerate`, `sourceField`                  | normalised (not rejected); kept on update unless cleared                            | text input                                                                              | text                  | no          | Derived from `sourceField`, else `title`/`name`                           |
| `json`     | —                                              | JSON-serialisable only                                                              | JSON textarea                                                                           | text                  | no          | Escape hatch; not queryable inside                                        |
| `richtext` | —                                              | array of nodes `{ type, text?, children?, … }`                                      | simple block editor (see below)                                                         | plain text, truncated | no          | Not queryable inside                                                      |
| `relation` | `collection`, `many`, `onDelete`               | referenced ids must exist; `onDelete` `restrict` (default) / `cascade` / `set-null` | search picker; chips for `many`                                                         | label of the target   | **no**      | `depth: 1` populates one batched query per relation field; top-level only |
| `upload`   | `collection`                                   | must name an existing document of an upload collection                              | upload picker (upload new, or choose existing) + preview                                | thumbnail / label     | **no**      | Always `restrict`; one `relation` to an `upload: true` collection         |
| `group`    | `fields`                                       | recursive                                                                           | fieldset                                                                                | muted summary         | no          | Stored as JSON in one column; not queryable inside                        |
| `array`    | `fields`, `minRows`, `maxRows`                 | recursive; row count bounds                                                         | named rows, Add/Remove (at `minRows`/`maxRows` they stop)                               | count                 | no          | Stored as JSON                                                            |
| `blocks`   | `blocks` (`defineBlock`), `minRows`, `maxRows` | each row's `blockType` must be a declared block; recursive                          | per-block fieldsets; unknown stored block types are kept untouched and shown as unknown | count                 | no          | Rows are `BlockValue`, deliberately not a discriminated union             |

**Dates.** A `date` is an ISO-8601 string in `toISOString()` form everywhere — in the database, on Local API reads and in HTTP responses (`2026-01-15T10:30:00.000Z`). Writes accept a
`Date`, or any string/number `Date` can parse, and Forge stores the canonical string. `defineField.date({ withTime: true })` reaches the field metadata: the admin then uses
`datetime-local`, shows the viewer's wall-clock time and submits a canonical instant; without it the control submits a `YYYY-MM-DD` day. There is no timezone setting.

**Rich text.** The admin's editor is a **simple block editor** (paragraph-level blocks with move/remove), not a WYSIWYG. A tree it cannot represent stays editable as an explicit,
labelled **JSON view** instead of being flattened. The stored format is the same either way.

**Arrays and blocks.** `minRows`/`maxRows` are validated on the server and respected by the admin. A stored block whose type is no longer in the schema is preserved on save and only removed
deliberately.

**Relation population.** `depth` accepts `0` (ids) or `1` (the referenced documents). Nothing deeper is populated, and relations inside `group`/`array`/`blocks` are refused at startup.

**Localization — exactly what the runtime accepts.** Declare `locales` on a collection or global and mark **top-level `text`/`textarea`** fields `localized: true`. Refused at startup: a
localized field without `locales`; a localized field of any other kind; a localized field nested in `group`/`array`/`blocks`; a localized `relation`/`upload`. Filtering or sorting on a
localized field is not supported. There is no arbitrary nested or per-field-kind localization.

## Feature matrix

| Capability                        | Status                | Notes / where it is proven                                                                                                       |
| --------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Schema DSL (15 kinds)             | stable 1.0            | `packages/core` tests; coverage floor enforced                                                                                   |
| Local API                         | stable 1.0            | Trusted by default (`overrideAccess: true`); the whole pipeline                                                                  |
| REST API                          | stable 1.0            | Stable envelope; no GraphQL                                                                                                      |
| Validation, defaults              | stable 1.0            | Every write; `defaultValue` on create only                                                                                       |
| Hooks                             | stable 1.0            | Nine collection stages plus field hooks                                                                                          |
| Row access, field access          | stable 1.0            | Functions returning a boolean or a query; HTTP never trusts a caller override                                                    |
| Drafts, versions, restore         | stable 1.0            | Draft visibility enforced on reads, files and relations                                                                          |
| Globals                           | stable 1.0            | Singleton; `read`/`update` access only                                                                                           |
| Localization                      | intentionally limited | Top-level `text`/`textarea` only (see above)                                                                                     |
| Relations, `depth: 1`             | intentionally limited | One population level                                                                                                             |
| Relation integrity                | stable 1.0            | `restrict`/`cascade`/`set-null`, atomic; users are restrict-only                                                                 |
| Uploads (multipart, `handleFile`) | stable 1.0            | Ownership via `_storageKey`; no presigned uploads, no image processing, no Local API upload helper                               |
| Browser sessions, CSRF            | stable 1.0            | `HttpOnly` cookie, 24-hour signed token, CSRF for cookie mutations; logout is client-state only                                  |
| API keys                          | stable 1.0            | Scoped, hashed, shown once                                                                                                       |
| Typed Angular client              | stable 1.0            | `ForgeSchema` / `injectForgeClient`; no code generation                                                                          |
| Signal resources                  | stable 1.0            | Abort superseded requests, no stale overwrite, reset on identity change                                                          |
| SSR, request isolation            | stable 1.0            | `provideForgeCmsServer`; explicit origin; per-render state                                                                       |
| Public hydration transfer         | stable 1.0            | Opt-in per resource (`transfer: 'public'`), anonymous data only                                                                  |
| Angular admin                     | stable 1.0            | Angular 21 only; no admin on Angular 22 yet                                                                                      |
| Schema drift detection            | stable 1.0            | `planSchema()` / `SchemaDriftError`                                                                                              |
| Reviewed migrations               | stable 1.0            | Append-only ledger, checksums, destructive opt-in; no down migrations                                                            |
| Backup / restore procedure        | stable 1.0            | Procedures rehearsed on both profiles; no atomic cross-store snapshot, no PITR                                                   |
| Cloudflare D1 + R2                | stable 1.0            | See the deployment table                                                                                                         |
| libSQL + S3                       | stable 1.0            | Garage `v2.4.1` certified                                                                                                        |
| Cloudflare Analytics Engine       | **experimental**      | Opt-in; verified onboarding recipe ([guide](../apps/www/src/content/docs/analytics.md)); may change in any release               |
| Agent Kit (`@forge-cms/agent`)    | **experimental**      | Dev-time, read-only local MCP server + skill pack ([guide](../apps/www/src/content/docs/agent-kit.md)); not a runtime dependency |
| Strata integration                | not a Forge feature   | Consumer dogfood in `apps/tiny-project` only; not part of the 1.0 API                                                            |

## Deployment profiles

What "certified" means here: a named automated or recorded gate ran against exact artifacts. Evidence layers are separate and are not interchangeable:
(1) mock/unit adapter tests · (2) local real workerd + D1 + R2 · (3) packed production consumer · (4) remote isolated Cloudflare staging (spec 090) · (5) **your own** production deployment.
Layer 4 is evidence for the framework and the profile; it is not a universal production guarantee or an SLA, and layer 5 is yours to verify
([DEPLOYMENT-HEALTH.md](DEPLOYMENT-HEALTH.md), [STAGING-REHEARSAL.md](STAGING-REHEARSAL.md)).

| Profile        | Database            | Files                           | Runtime                           | Certified evidence                                                                                                                                                                                                                                                                                                |
| -------------- | ------------------- | ------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cloudflare** | D1 (`DB`)           | R2 (`BUCKET`)                   | Pages / Workers-compatible output | Adapter contracts · local workerd/D1/R2 · packed production consumer · **certified on isolated Cloudflare staging**: real origin, auth/CSRF, content, files, same-commit redeploy persistence, remote D1 `in`-list sizes 80/99/100/120/400, D1 export, snapshot-derived R2 copy, backup restored into empty D1/R2 |
| **Portable**   | on-disk libSQL file | S3-compatible (`@forge-cms/s3`) | Node (`node-server` Nitro preset) | Packed production server · restart persistence · upload/read/delete · backup/restore, against real Garage `v2.4.1`                                                                                                                                                                                                |

| S3 provider                     | Status                                                    |
| ------------------------------- | --------------------------------------------------------- |
| Garage `v2.4.1`                 | **certified** (CI, pinned image digest)                   |
| AWS S3                          | configurable, **not certified**                           |
| Backblaze B2                    | configurable, **not certified**                           |
| Wasabi                          | configurable, **not certified**                           |
| Any other S3-compatible service | possible through the adapter; not automatically certified |

Not covered by any gate: serverless filesystems for libSQL (a `file:` database on an ephemeral disk is lost), Turso as a managed service, Node hosts other than the tested Linux CI image,
and any traffic-level load. A production build never falls back to in-memory adapters; the app's server factory must refuse to start on an incomplete profile (the reference is
`apps/tiny-project`'s `profile.ts`).
