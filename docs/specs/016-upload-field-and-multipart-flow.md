# 016 — Add an `upload` field kind and a real multipart upload flow

- **Status:** done
- **Author:** agent draft (approved via user instruction to implement the Payload-parity roadmap)
- **Date:** 2026-07-20
- **Branch:** main
- **Affected packages/apps:** @forge-cms/core, @forge-cms/runtime

## Context / Why

`@forge-cms/storage`'s `StorageAdapter` (put/get/delete/getPublicUrl/list) and `R2StorageAdapter` already
implement real file storage — that part is solid. Two things are missing, both named in STATE.md: a field
kind for referencing an uploaded file from another collection (`upload`, alongside `relation`), and an
actual HTTP path that accepts file bytes and calls `storage.put` — today there is no route, in `apps/www`
or `@forge-cms/runtime`, that a client can multipart-POST a file to.

## Goal

A collection can opt in to file uploads (`defineCollection({ ..., upload: true })`); `POST
/api/v1/[collection]` on such a collection accepts a `multipart/form-data` body, stores the file via the
configured `StorageAdapter`, and creates a normal document carrying the file's metadata. Other collections
reference an uploaded document via a new `upload` field kind (`defineField.upload({ collection: 'media' })`),
structurally identical to a single `relation`.

## Non-goals

- Image resizing/thumbnail generation.
- Multiple files per upload request, or more than one `upload`-enabled field kind target per collection.
- Deleting the underlying storage object when its media document is deleted (an orphaned R2/in-memory
  object is left behind — same "don't destroy on the happy path without being asked" posture as spec 014's
  additive-only migrations).
- Presigned/direct-to-storage upload URLs — the file body still passes through the ForgeCMS server.
- A dedicated upload widget in `@forge-cms/admin`'s schema-driven form (falls back to the generic field
  UI, same as richtext in spec 015).
- Changing `handleCreate`'s JSON-body path — multipart is an additional accepted content-type, not a
  replacement.

## Design

### `@forge-cms/core` — `upload` field kind

```ts
export interface UploadFieldOptions extends BaseFieldOptions {
  collection: string; // the upload-enabled collection this field references
}
export type UploadField = FieldDefinition<'upload', string, UploadFieldOptions>;
// FieldKind gains 'upload'; AnyField gains UploadField; defineField.upload(options)
```

Validation: identical rule to a non-`many` `relation` (must be a string id) — `validateField`'s `'upload'`
case reuses the same check, with its own `'type_upload'` error code for a clearer message. Storage: `TEXT`,
no special `toDbValue`/`fromDbValue` handling needed (a bare string, like `relation`).

### `@forge-cms/core` — `CollectionDefinition` gains `upload?: boolean`

Marks a collection as upload-enabled. No other schema change — the collection still declares its own
fields normally; whichever of `filename`/`url`/`contentType`/`filesize` it declares are the ones
`handleCreate` will populate (see below), so an upload collection is expected to declare at least
`filename` and `url`.

### `@forge-cms/runtime` — `handleCreate` accepts multipart bodies

When `collection.upload === true` and the request's `content-type` header starts with
`multipart/form-data`: read `await context.request.formData()`, take the `file` entry (must be a `File`;
missing or wrong type → `400`), and:

1. Build a storage key: `` `${collection.slug}/${crypto.randomUUID()}-${file.name}` ``.
2. `runtime.adapters.storage.put({ key, body: file, contentType: file.type })`.
3. `runtime.adapters.storage.getPublicUrl(key)`.
4. Build a data object from whichever of these the collection actually declares as a field (checking
   `collection.fields[name]`, so a collection only needs `filename`/`url` to work, not all four):
   `filename` (`file.name`), `url`, `contentType` (`file.type`), `filesize` (`file.size`).
5. Merge in any other form fields present in the `FormData` whose name matches a declared field on the
   collection (e.g. an `alt` text field alongside the file) — same "only known fields" filter.
6. Continue through the existing `assertWritableFields` → `beforeChange` → `validateCollection` →
   `database.create` → `afterChange` pipeline unchanged, with this merged object as the body.

A non-multipart request to an `upload: true` collection behaves exactly as before (plain JSON create) —
this is additive, not a requirement to always upload a file.

## Implementation plan

- [x] `packages/core/src/index.ts`: `UploadFieldOptions`, `UploadField`; extend `FieldKind`/`AnyField`;
      `defineField.upload`; `CollectionDefinition.upload?: boolean`.
- [x] `packages/core/src/validation.ts`: `'upload'` case in `validateField`; `'type_upload'` error code.
- [x] `packages/db/src/schema-generator.ts`: `'upload'` in `fieldKindToSqlType` (`TEXT`).
- [x] `packages/runtime/src/handlers.ts`: multipart branch in `handleCreate` (parse `FormData`, call
      `storage.put`, merge known fields into the body before the existing pipeline).
- [x] Tests: `packages/core/src/validation.test.ts` (`upload` field validation); `schema-generator.test.ts`
      (SQL type); `packages/runtime/src/handlers.test.ts` (multipart create on an `upload: true` collection
      stores the file via a fake `StorageAdapter` and creates a record with `filename`/`url` populated;
      missing `file` part → `400`; a non-multipart JSON POST to the same collection still works unchanged;
      a multipart POST to a non-upload collection is rejected — treated as an unparseable JSON body,
      matching today's existing "Invalid JSON body" `400` for any non-JSON `POST`).
- [x] `docs/ARCHITECTURE.md` / `docs/STATE.md`: document the `upload` field kind, `collection.upload`, and
      the multipart path; update the `@forge-cms/core`/`@forge-cms/runtime`/`@forge-cms/storage` rows;
      mark "real multipart upload flow" done.
- [x] Changeset: `@forge-cms/core`, `@forge-cms/db`, `@forge-cms/runtime` (minor — additive).

## Test plan

- `validation.test.ts`: an `upload` field accepts a string id, rejects a non-string.
- `handlers.test.ts`: build a `multipart/form-data` `Request` with a `File` part (and an extra `alt` text
  part) against a collection with `upload: true` and fields `filename`/`url`/`alt` — `handleCreate` returns
  `201` with `filename`/`url`/`alt` populated on the created record, and the fake storage adapter recorded
  exactly one `put` call; a multipart request missing the `file` part → `400`; a plain JSON POST to the
  same collection still creates normally (regression check that the JSON path is untouched).

## Acceptance criteria

1. `defineField.upload({ collection })` type-checks, validates a string id, rejects non-strings.
2. `POST /api/v1/[collection]` with a `multipart/form-data` body on an `upload: true` collection stores the
   file via `runtime.adapters.storage.put` and creates a document with the collection's declared subset of
   `filename`/`url`/`contentType`/`filesize` populated.
3. The existing JSON-body `POST` path is unaffected on both upload and non-upload collections.
4. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Open questions

(none — approved)

## Outcome

Shipped 2026-07-20 as specified, no divergence. `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
green.
