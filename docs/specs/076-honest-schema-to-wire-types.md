# 076 — Honest schema-to-wire types for the Angular client

- **Status:** done (implemented and verified on the branch; merge pending)
- **Author:** agent draft (implementation approved by the maintainer, 2026-10-02)
- **Date:** 2026-10-02
- **Branch:** feature/spec-076-honest-schema-to-wire-types
- **Affected packages/apps:** @forge-cms/core, @forge-cms/db, @forge-cms/auth, @forge-cms/runtime,
  @forge-cms/angular, @forge-cms/admin, apps/tiny-project, apps/demo-aesthetics, scripts/verify-release.mjs,
  api-baseline, docs

## Context / Why

Roadmap 0.8 / C02 ([0.8-angular-client.md](../roadmap/v1/0.8-angular-client.md)). C01 (spec 075, merged in
PR #62) gave `@forge-cms/angular` a configurable transport and one structured error, but every content
method is still `getDocument<T = Record<string, unknown>>(collection: string, …)`: the caller invents `T`,
any slug and field compiles, and nothing ties the browser to the schema the server enforces.

Investigating the actual pipeline (`operations.ts`, `populate.ts`, `field-access.ts`, `localization.ts`,
`schema-generator.ts`, `handlers.ts`) found that one `CollectionData<T>` cannot describe what crosses the
wire:

- **Dates (Finding 24).** `defineField.date()` infers `Date`. A typed create rejects the ISO strings the
  validator accepts. Reads differ by adapter: SQL (`fromDbValue`) revives a `Date`, InMemory returns what
  was written. Over HTTP, SQL prints `toISOString()` while InMemory echoes the caller's text (`"2026-01-15"`).
  A **number** date (accepted by validation) is stored by SQLite as text `"1700000000000"`, which
  `new Date()` cannot parse: the HTTP response carries `null` on libSQL/D1 and a number on InMemory. This is
  a real bug, not only a typing gap.
- **Population.** `depth: 1` replaces a single relation/upload id with the target document **or `null`**
  (missing, inaccessible, draft hidden); a many relation becomes an array of only the readable targets. The
  target is field-filtered by its own `access.read`, is not populated further, and its localized fields stay
  per-locale maps (locale resolution only runs on the top-level document).
- **Field access.** `filterReadableFields()` drops a field whose `access.read` denies the caller. Whether
  it is present depends on the user, so a typed read cannot promise it.
- **Optional fields.** InMemory stores only written keys (an unset optional field is absent); SQL returns
  `null`. Both are possible on the wire.
- **Localization.** Without `?locale=` a localized field is its stored per-locale map; with a locale it is
  resolved (with fallback) to one string. Writes mirror this: without `locale` the value must be a map, with
  `locale` a plain string. A `required` localized field accepts the empty map `{}`, which then reads back
  absent — a validation bug.
- **Write responses (spec 068).** A create/update/global write returns the read projection, or only
  `{ id }` when the writer may not read the result.
- **Literal loss.** `defineField.text(options: TextFieldOptions)` returns `TextField`, so `required: true`,
  `access.read`, `localized`, `many`, a relation's target slug and select options are erased from the type.
  `defineCollection` widens `drafts: true` to `boolean`. `defineUsersCollection()` returns slug `string`,
  which collapses any registry containing it to "every slug is valid".

## Goal

A consumer that shares the **type** of its ForgeCMS content model with the browser gets a client whose
slugs, fields, query keys, create/update payloads and read results are checked against the JSON the server
actually sends — with no code generation, no server code in the bundle, and an explicit untyped path.

## Non-goals

- C03: stale requests, resource ownership/cancellation, credential-switch behaviour; any resource redesign
  (resources only get schema-bound type parameters instead of a free `<T>`).
- Angular/Analog peer widening, compatibility matrix, SSR, Strata (incl. Server Components), S3/portable
  storage, admin redesign, GraphQL, a codegen CLI, a new HTTP envelope, retries, deployments, production D1
  migrations.
- Typing `afterRead` hook reshaping: a hook can return anything; types describe the declared schema. A
  collection whose hooks reshape documents should be read through the untyped client.
- Typing `where` **values** or operators per field (field names are typed; values stay loose, as in the
  typed Local API, spec 047). Runtime query validation stays the authority for untrusted input.
- Changing the typed Local API's create/update semantics beyond the date input type (they stay `Partial`).
- Discriminated-union typing of `blocks` rows (stays `{ blockType: string; [key: string]: unknown }`).
- Adding `depth`/`locale` options to `getGlobal`/`updateGlobal` (the Angular API does not expose them today;
  globals are typed as they are fetched: depth 0, no locale).

## Design

### 1. One date representation (Finding 24) — behaviour fix

A date is an ISO-8601 string in `Date.prototype.toISOString()` form **at rest, on Local API reads and on the
wire**. Writes keep accepting what validation accepts (`Date`, a parseable string, a finite number).

- `@forge-cms/runtime` — new private `canonicalizeDates(fields, data)` (`dates.ts`): every valid top-level
  `date` value and every `date` nested in `group`/`array`/`blocks` (rows matched by `blockType`) becomes
  `new Date(value).toISOString()`; `null`/`undefined`/unparseable values are left to validation. It runs
  after `beforeChange` hooks and output screening, before relation guards and persistence, in `create`,
  `prepareUpdate` (so `update`, `restoreVersion`, relation set-null), `updateGlobal`, and `preview` (whose
  response must match a read).
- `@forge-cms/db` — `fromDbValue(value, 'date')` returns a canonical string instead of a `Date`: a parseable
  stored string → `toISOString()`, anything else unchanged (an unparseable legacy value is returned as
  stored instead of becoming `Invalid Date` → `null`). libSQL and D1 share it. HTTP output for existing SQL
  rows is byte-identical to before (`JSON.stringify(Date)` was `toISOString()`).
- `@forge-cms/core` — `DateField` = `FieldDefinition<'date', string, …>` (read value). New write mapping
  `FieldInputValue<F>`: `date` → `Date | string`, nested composites mapped recursively; `CollectionInput`
  (typed Local `create`/`update`/`preview` data) uses it, so the typed Local API accepts ISO strings and
  `Date`s and returns strings.

**Intentional pre-1.0 migration:** Local API reads of date fields on libSQL/D1 return `string` instead of
`Date`, and `CollectionDocument`'s date fields are typed `string`. Code calling `.getTime()` on them fails to
compile and should use `new Date(value)`.

### 2. Validation fix — required localized field

`validateField`: a `required` + `localized` value that is an object with no locale keys fails with
`required` (today `{}` passes and reads back absent). Regression test in `@forge-cms/core`.

### 3. Literal-preserving DSL (`@forge-cms/core`, `@forge-cms/auth`) — types only

Each `defineField.*` keeps its options as a literal type through an overload pair (an optional-with-default
generic breaks contextual typing of access/hook callbacks — verified with tsc 5.9):

```ts
function text(): FieldDefinition<'text', string, {}>;
function text<const TOptions extends TextFieldOptions>(
  options: TOptions
): FieldDefinition<'text', string, TOptions>;
```

Same for `number`, `boolean`, `date`, `select`, `slug`, `email`, `textarea`, `richtext`, `relation`,
`upload`, `group`, `array`, `blocks`. `json<TValue = unknown, const TOptions extends JsonFieldOptions =
JsonFieldOptions>(options?)` keeps its value annotation (an explicit `json<Meta>({...})` call cannot infer
`TOptions` — partial inference — and falls back to the conservative broad options). `group`/`array` value
types stay `InferFields<…>` computed from `TOptions['fields']`. `InferFields` drops the `readonly` modifier
the `const` inference adds. Every returned type is still assignable to the existing `TextField`/…/`AnyField`
aliases, so `FieldMap`, `CollectionDefinition` and all runtime code are unchanged.

`defineCollection`/`defineGlobal` gain a defaulted third type parameter so a literal `drafts: true`
survives:

```ts
export function defineCollection<
  TSlug extends string,
  TFields extends FieldMap,
  TDrafts extends boolean | undefined = undefined
>(
  config: CollectionDefinition<TSlug, TFields> & { drafts?: TDrafts }
): CollectionDefinition<TSlug, TFields> & DraftsFlag<TDrafts>;
/** `{ drafts: true }` for a literal `true`, otherwise `{}`. */
export type DraftsFlag<TDrafts> = [TDrafts] extends [true] ? { drafts: true } : {};
```

`defineUsersCollection<TSlug extends string = 'users'>(options?: { slug?: TSlug })` returns
`CollectionDefinition<TSlug, …>` instead of `CollectionDefinition<string, …>`.

Runtime behaviour of all of these is unchanged.

### 4. The schema type and the two clients (`@forge-cms/angular`)

`@forge-cms/angular` gains a **type-only** dependency on `@forge-cms/core` (declared in `dependencies` so a
consumer's compiler resolves the `.d.ts`; `import type` only, so no emitted JavaScript imports it —
verified by the packed-consumer check below).

```ts
/** A content model as the browser sees it: the types of the registered collections and globals. */
export interface ForgeSchema<
  TCollections extends readonly CollectionDefinition[] = readonly CollectionDefinition[],
  TGlobals extends readonly GlobalDefinition[] = readonly GlobalDefinition[]
> {
  readonly collections: TCollections;
  readonly globals: TGlobals;
}
/** The dynamic schema: any slug, any field, `UntypedDocument` results. */
export type UntypedForgeSchema = ForgeSchema;

export type ForgeCollectionSlug<S extends ForgeSchema> = S['collections'][number]['slug'];
export type ForgeGlobalSlug<S extends ForgeSchema> = S['globals'][number]['slug'];

/** What every untyped read/write resolves to. Only `id` is promised. */
export interface UntypedDocument {
  id: string;
  [field: string]: unknown;
}
```

The consumer shares types only:

```ts
// src/app/forge-schema.ts (browser)
import type { ForgeSchema } from '@forge-cms/angular';
import type { collections, siteGlobal } from '../server/content'; // erased: no server code is bundled
export type SiteSchema = ForgeSchema<typeof collections, [typeof siteGlobal]>;
```

`CmsApiService` becomes `CmsApiService<S extends ForgeSchema = UntypedForgeSchema>` — one class, one
transport (`ForgeRequester`, unchanged from C01). `inject(CmsApiService)` is the explicit **untyped escape
hatch** (dynamic slugs, `UntypedDocument`); admin keeps using it. The typed client is the same instance:

```ts
/** The injected `CmsApiService`, typed by `S`. Call in an injection context. No runtime cost. */
export function injectForgeClient<S extends ForgeSchema>(): CmsApiService<S>;
```

The method-level `<T>` generics are **removed**: a caller can no longer assert an arbitrary response type.

| Method (typed `S`)                                   | Arguments                                                       | Result                                       |
| ---------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------- |
| `getDocuments` / `listDocuments`                     | `slug`, `ForgeQueryOptions<S, slug, D, L>?`                     | `ForgeDocument<S, slug, D, L>[]` / paginated |
| `findOne`                                            | `slug`, `ForgeWhere?`, options without where/limit/offset/page  | `ForgeDocument<S, slug, D, L> \| null`       |
| `getDocument`                                        | `slug`, `id`, `{ depth?: D; locale?: L }?`                      | `ForgeDocument<S, slug, D, L>`               |
| `createDocument`                                     | `slug`, `ForgeCreateInput<S, slug, L>`, `{ locale?: L }?`       | `ForgeWriteResult<S, slug, L>`               |
| `updateDocument`                                     | `slug`, `id`, `ForgeUpdateInput<S, slug, L>`, `{ locale?: L }?` | `ForgeWriteResult<S, slug, L>`               |
| `setDocumentStatus`                                  | drafts `slug`, `id`, `'draft' \| 'published'`                   | `ForgeWriteResult<S, slug>`                  |
| `uploadFile`                                         | `slug`, `File`, `{ [field]?: string }`                          | `ForgeWriteResult<S, slug>`                  |
| `previewDocument`                                    | `slug`, `ForgeUpdateInput<S, slug>`, `{ id?; depth?: D }`       | `Partial<ForgeDocument<S, slug, D>>`         |
| `deleteDocument`                                     | `slug`, `id`                                                    | `void`                                       |
| `getGlobal` / `updateGlobal`                         | global `slug` (+ `ForgeGlobalInput<S, slug>`)                   | `ForgeGlobalDocument \| null` / write result |
| auth, users, `getCollections`, `onUnauthorized`, ... | unchanged                                                       | unchanged                                    |

`D extends 0 | 1 = 0` and `L extends string | undefined = undefined` are inferred from the options literal.
With `UntypedForgeSchema` every slug is `string`, data is `Record<string, unknown>`, `where` is the existing
`QueryWhere`, and every result is `UntypedDocument`.

Resources keep their shape; the free `<T>` becomes schema-bound type parameters (defaults = untyped):

```ts
collectionResource<S extends ForgeSchema = UntypedForgeSchema, TSlug extends ForgeCollectionSlug<S> = …,
  D extends 0 | 1 = 0>(params: () => CollectionRequest<S, TSlug, D> | undefined)
documentResource<S, TSlug, D>(params: () => DocumentRequest<S, TSlug, D> | undefined)
```

### 5. Projections

All are distributive over a slug union and collapse to the untyped shapes for an untyped schema. Field
options are read from the captured literal; **broad (non-literal) options are treated conservatively**
(not required, possibly hidden, possibly many).

**Read — `ForgeDocument<S, Slug, D = 0, L = undefined>`** = `{ id: string; created_at: string;
updated_at: string }` & `{ _status: 'draft' | 'published' }` (drafts collections only) & per field:

| Field                          | Key                    |
| ------------------------------ | ---------------------- |
| `access.read: []` (nobody)     | omitted                |
| any other `access.read` rule   | `name?: Value`         |
| `required: true`, no read rule | `name: Value`          |
| otherwise                      | `name?: Value \| null` |

| Kind                                  | `Value`                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| text, textarea, email, slug           | `string`                                                                                       |
| number / boolean                      | `number` / `boolean`                                                                           |
| date                                  | `string` (ISO-8601, `toISOString()` form)                                                      |
| select                                | union of the literal `options`, else `string`                                                  |
| json / richtext                       | the `json<T>` annotation (else `unknown`) / `RichTextContent`                                  |
| relation, `D = 0`                     | `string` (single), `string[]` (many), `string \| string[]` (unknown)                           |
| relation, `D = 1`                     | `Target \| null` (single), `Target[]` (many)                                                   |
| upload                                | as a single relation                                                                           |
| group / array                         | nested object / rows of the same rules (required → present, else optional + `null`; no access) |
| blocks                                | `{ blockType: string; [key: string]: unknown }[]`                                              |
| localized (text/textarea), `L` absent | `ForgeLocalizedValue` = `Record<string, string>` (locale → value)                              |
| localized, `L` a string               | `string`                                                                                       |
| localized, `L` possibly undefined     | `string \| ForgeLocalizedValue`                                                                |

`Target` = `ForgeDocument<S, targetSlug, 0, undefined>` (targets are not populated further and their
localized fields stay maps); an unknown target slug → `UntypedDocument`.

**Create — `ForgeCreateInput<S, Slug, L>`**: never `id`/timestamps/`_storageKey`; `_status?` on drafts
collections; fields with `access.write: []` omitted. A key is **required** only when the field is
`required: true`, has no `defaultValue` and is not an `autoGenerate` slug. Optional values accept `null`.
Values: date → `Date | string` (the transport's `JSON.stringify` sends a `Date` as its ISO string);
relation → `string`/`string[]`; upload → `string`; select → its options; group/array → nested create rules;
localized → `string` with a locale, `ForgeLocalizedValue` without.

**Update — `ForgeUpdateInput<S, Slug, L>`**: every key optional; `null` only for non-required fields;
otherwise as create. **`ForgeGlobalInput<S, G>`** = update rules for the global (no locale).

**Write result — `ForgeWriteResult<S, Slug, L>`** = `ForgeDocument<S, Slug, 0, L> | ForgeWriteReceipt`
where `ForgeWriteReceipt = { id: string }` (spec 068). Narrow with `'created_at' in result`.

**Globals — `ForgeGlobalDocument<S, G>`** = the read projection at depth 0 without locale, with the global's
system fields as the HTTP fixture observes them.

**Queries — `ForgeQueryOptions<S, Slug, D, L>`** = `QueryOptions` with `where?: ForgeWhere<S, Slug>`,
`sort?: ForgeSort<S, Slug>`, `depth?: D`, `locale?: L`. `ForgeWhere` keys: declared fields + `id`,
`created_at`, `updated_at` (+ `_status` on drafts collections), recursively under `and`/`or`; values stay
`WhereCondition`. `ForgeSort` = one of those names or `{ field, order? }[]`. `buildQueryString` is unchanged.

### 6. Browser/server boundary

The schema is shared with `import type`; executable configuration (hooks, access functions, adapters,
secrets) never reaches browser JavaScript. Evidence: the packed typed consumer's server module contains a
hook with a marker string; its compiled browser module must not import the server module or
`@forge-cms/core` and must not contain the marker. `@forge-cms/angular`'s packed `dist/*.js` must not import
`@forge-cms/core`.

### 7. Migration (documented in the changeset and the Angular guide)

- `api.getDocument<Post>('posts', id)` → `injectForgeClient<SiteSchema>().getDocument('posts', id)`, or
  keep `inject(CmsApiService)` and treat results as `UntypedDocument`.
- `collectionResource<Post>(…)` → `collectionResource<SiteSchema, 'posts'>(…)` or untyped.
- Typed create/update results are a union with `ForgeWriteReceipt`.
- Local API date fields are strings (§1).

## Implementation plan

- [x] Spec (this file)
- [x] core: literal-preserving `defineField` overloads, `DraftsFlag` on `defineCollection`/`defineGlobal`,
      `DateField` → `string`, `FieldInputValue`/`InferInputFields`, `CollectionInput` uses it, required
      localized fix + tests; auth: `defineUsersCollection` slug literal
- [x] db: `fromDbValue` canonical date string + tests; runtime: `canonicalizeDates` wired into
      create/prepareUpdate/updateGlobal/preview + InMemory/libSQL regression tests
- [x] angular: `schema.ts` (schema, projections, query types), generic `CmsApiService<S>`,
      `injectForgeClient`, schema-bound resources, exports, unit tests
- [x] angular: compile-time type tests (`typed-client.test.ts`), positive + `@ts-expect-error`
- [x] admin/www/apps compile against the new untyped surface
- [x] tiny-project: real-HTTP wire fixture (date, depth 0/1, null/missing/inaccessible targets, many,
      hidden field, localized with/without locale, global, draft workflow, write receipt)
- [x] demo-aesthetics dogfood: admin pages through `injectForgeClient<DemoSchema>()`; remove Finding 24
      workaround (`isoDate`, casts)
- [x] verify-release: typed packed Angular consumer + boundary check; api-baseline update
- [x] docs: Angular guide, DEMO-FINDINGS (F24), STATE, ROADMAP, README/version text; changesets

## Test plan

- `packages/angular/src/typed-client.test.ts` — `expectTypeOf` + `@ts-expect-error` in never-invoked
  functions, checked by `pnpm --filter @forge-cms/angular typecheck`: known/unknown collection and global
  slug, known/unknown where and sort field, valid/invalid create (missing required, unknown key, wrong
  value), valid/invalid partial update, date write (`Date | string`) vs read (`string`), depth-0 and
  depth-1 relation/upload shapes, nullable single target, many populated array, hidden/never-readable
  fields, localized with/without locale, global read/write, draft workflow (`_status`, `setDocumentStatus`
  restricted to drafts collections), write receipt narrowing, untyped escape hatch, resource typing.
- Angular unit tests: typed client sends the same requests (URL, query, body) as the untyped one.
- core tests: literal option capture, drafts flag, input types, required-localized validation;
  `packages/runtime/src/typed-local-api.test.ts` date input/read types.
- db tests: `fromDbValue` date canonicalization; runtime tests: number/`Date`/string date writes read back
  canonical on InMemory and libSQL, nested dates, preview, globals.
- `apps/tiny-project/src/tests/wire-types.integration.test.ts`: real HTTP through public handlers and the
  typed client; asserts runtime values and their compile-time types.
- `pnpm release:verify`: typed packed consumer (positive + `@ts-expect-error`, boundary check).
- Gates: `pnpm format`, `lint`, `typecheck`, `test`, `build`, `release:verify`, `check:api`, plus
  `test:libsql`, `test:cloudflare`, `test:upgrade` (db/runtime behaviour change), `e2e:tiny-project`,
  `e2e:demo` (dogfood) per QUALITY.md.

## Acceptance criteria

1. An unknown collection slug, global slug, where/sort field, create field, update field, or a clearly
   incompatible value fails `tsc` in the Angular type tests and in the packed consumer.
2. Valid CRUD and the draft workflow compile with no `<T>` and no `as` cast in consumer code.
3. `getDocument(…, { depth: 1 })` is typed `Target | null` for a single relation/upload and `Target[]` for a
   many relation, and the HTTP fixture observes `null` for an inaccessible and a dangling target and an
   array without the hidden target.
4. A field with an `access.read` rule is optional in the read type, and the HTTP fixture shows it absent for
   an anonymous caller; `access.read: []` fields are not in the type.
5. Over HTTP, a date written as a `Date`, an ISO string, a date-only string or a number reads back as the
   same `toISOString()` string on InMemory and libSQL; the read type is `string`.
6. A localized field reads as a per-locale map without `locale` and as a string with it, matching the
   types; a required localized `{}` is rejected.
7. The packed typed consumer compiles from tarballs only, its browser output imports neither the server
   module nor `@forge-cms/core` and lacks the hook marker; `@forge-cms/angular`'s packed JS does not import
   `@forge-cms/core`.
8. C01 behaviour is unchanged (existing transport/session/error tests pass untouched).
9. `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm release:verify` green,
   plus the applicable QUALITY.md suites.

## Open questions

None. The maintainer's instruction approves implementation; the date representation follows Finding 24's
recorded direction ("input `Date | string`, one read representation across adapters"), choosing the
JSON-native string because the wire can only carry a string and nested/populated dates were never revived.

## Outcome

Shipped as designed: `ForgeSchema` + `injectForgeClient<S>()` over a schema-generic
`CmsApiService<S = UntypedForgeSchema>`, the read/create/update/write-result/global/query projections of
§5, literal-preserving DSL types, one ISO date representation (Finding 24 closed), the required-localized
validation fix, a real-HTTP fixture on in-memory **and** libSQL, a typed packed consumer, and the demo's
admin dashboard/media library on the typed client.

Divergences and findings during implementation:

- **`FieldDefinition`'s options parameter lost its `extends BaseFieldOptions` constraint** (not in the
  original §3). A literal such as `{ collection: 'users' }` shares no key with the all-optional
  `BaseFieldOptions`, so TypeScript's weak-type check rejected it as a type argument (and `FieldValue`
  resolved to `never`). Each factory still constrains its own options. The same weak-type rule shaped the
  `many` test in `schema.ts` (a key test, not `extends { many?: … }`).
- **Bug found and fixed:** a numeric date timestamp passed validation and read back as `null` on
  libSQL/D1 (a number on in-memory). Covered by `runtime/src/dates.test.ts` and the HTTP fixture.
- **Global system fields** observed over HTTP: `id`, `created_at`, `updated_at` (all strings), so
  `ForgeGlobalDocument` shares `ForgeDocumentMeta`.
- **Extra exported names** beyond §4's list, all type-only: `ForgeDocumentMeta`, `ForgeBlockRow`,
  `ForgeDraftsCollectionSlug`, `ForgeQueryField`, `ForgeUploadFields`, `ForgeGlobalWriteResult`,
  `ForgeDocumentReadOptions`, `ForgeWriteOptions`; core adds `FieldOptionsOf`. API baseline: additions
  only.
- An untyped write resolves `UntypedDocument` (a receipt `{ id }` is assignable to it), so dynamic code
  needs no narrowing; typed writes are `document | ForgeWriteReceipt`.
- `setDocumentStatus` sends its `PUT { _status }` directly instead of delegating (same request, so it can
  constrain the slug to drafts collections).
- The demo **seed** keeps the untyped runtime view for an unrelated reason (it passes
  `string | undefined` lookup ids under `exactOptionalPropertyTypes`); its comment now says so. The
  demo's settings page stays on the untyped client on purpose: it is a metadata-driven dynamic form.
- Release truth found while closing out: npm `0.8.3` was published by the PR #62 merge run (contains
  C01's code); its deploy health gates failed on the known production drift (operator migrations still
  pending). Docs/website version text updated to `0.8.3`; no production change was made.

Evidence (2026-10-02, local): `pnpm format`, `lint`, `typecheck`, `test`, `build`, `release:verify`
(incl. the typed packed consumer), `check:api`, `test:libsql` (4), `test:cloudflare` (279 + 1),
`test:upgrade` (33), `e2e:tiny-project` (13), `e2e:demo` (29), `e2e:www` (25) — all green.
