# 040 — Close the cheap core gaps found by the demo build

- **Status:** in-progress
- **Author:** agent draft (approved by the maintainer: "implement them now")
- **Date:** 2026-07-27
- **Branch:** `feature/demo-aesthetics-app`
- **Affected packages:** `@forge-cms/core`, `@forge-cms/runtime`, `@forge-cms/db`,
  `@forge-cms/storage`, `@forge-cms/cloudflare`, `@forge-cms/testing`

## Context / Why

[DEMO-FINDINGS.md](../DEMO-FINDINGS.md) records 22 gaps hit while building `apps/demo-aesthetics`.
Six of them are small, self-contained and cost the demo real workaround code. They are grouped here
because none justifies a spec of its own and all of them touch the same pipeline.

## Goal

Findings 1, 3 (partly), 9, 14, 19, 21 and 22 are fixed in the packages, and the corresponding
workarounds are deleted from the demo app.

## Non-goals

- The client SDK (spec 041) and the admin UI (spec 042) — separate specs in this series.
- A currency field kind, timezone normalisation, globals, `findBySlug`, query completeness.
- Image resizing or a CDN story for uploads. This spec only makes stored bytes reachable.

## Design

### 1. `depth: 1` populates `upload` fields (finding 9)

`getRelationFields` in `packages/runtime/src/populate.ts` filters on `field.kind === 'relation'`.
It now also accepts `upload`, whose `options.collection` names the target and which is always
single-valued.

### 2. `defaultValue` and `slug.autoGenerate` are honoured (finding 1)

New `packages/runtime/src/defaults.ts`:

```ts
export function applyFieldDefaults(
  collection: CollectionDefinition,
  data: Record<string, unknown>
): Record<string, unknown>;
export function applyAutoSlugs(
  collection: CollectionDefinition,
  data: Record<string, unknown>,
  existing?: Record<string, unknown>
): Record<string, unknown>;
```

- **Defaults** apply on `create` only, to fields whose incoming value is `undefined`. Composite and
  relation kinds are included — a default is just a value.
- **Auto slugs** apply on `create` and `update`, to `slug` fields with `autoGenerate: true`, when the
  incoming value is missing or an empty string. The source is `sourceField`, falling back to the
  first of `title`/`name` present on the merged document. A slug that is explicitly provided is
  normalised but never replaced.
- `slugify` moves into `@forge-cms/core` and is exported, because the DSL is what promises the
  behaviour: NFD-normalise, strip diacritics, lowercase, non-alphanumeric → `-`, trim `-`.
- Both run at the top of `create`/`update`, **before** `beforeValidate` hooks, so a hook can still
  override what they produced.

### 3. Hooks learn whether the caller was trusted (finding 19)

`BaseHookArgs` and `FieldHookArgs` in `@forge-cms/core` gain:

```ts
/** `true` when the operation skipped access control — a trusted server-side call. */
overrideAccess?: boolean;
```

Every hook invocation in `packages/runtime/src/hooks.ts` receives it from the operation. Optional, so
existing hooks keep compiling.

### 4. Adapter bindings are configurable (finding 14)

```ts
new D1DatabaseAdapter({ binding: 'ANALYTICS_DB' }); // default 'DB'
new R2StorageAdapter({ binding: 'MEDIA', publicUrlBase: 'https://cdn.example.com' }); // default 'BUCKET'
```

Constructor argument is optional; `init(env)` reads `env[binding]` and the error message names the
binding it looked for.

### 5. The in-memory database adapter sets timestamps (finding 22)

`create` sets `created_at`/`updated_at`, `update` refreshes `updated_at` — matching LibSQL and D1.
`runDatabaseAdapterContractTests` asserts it, so no adapter can drift again.

### 6. Stored files are reachable (finding 21)

- `InMemoryStorageAdapter` gains `setPublicUrlBase(base)` (same shape R2 already has). Its default
  stops being the fictional `https://forge.test/...` and becomes a **relative** `/api/media/<key>`,
  which is what a local app can actually serve.
- `@forge-cms/runtime` exports a transport handler:

```ts
export async function handleFile<TEnv>(
  context: ApiContext<TEnv>,
  options: { runtime: ForgeCmsRuntime<TEnv> }
): Promise<Response>;
```

It reads `context.params.key`, fetches the object from the storage adapter, and returns the bytes
with `content-type` and a cache header — 404 when the key is unknown, 400 when the key is missing.

## Implementation plan

- [x] `slugify` in core + export; `overrideAccess` on hook arg types
- [x] `populate.ts` covers `upload`
- [x] `defaults.ts` + wiring into `create`/`update`
- [x] hooks pass `overrideAccess` through
- [x] configurable bindings on D1/R2
- [x] in-memory timestamps + contract-test assertion
- [x] `setPublicUrlBase` on the in-memory storage adapter + `handleFile`
- [x] tests for each of the above
- [x] delete the corresponding workarounds in `apps/demo-aesthetics`
- [x] changeset + STATE.md + DEMO-FINDINGS.md updates

## Test plan

- `packages/runtime`: populate covers upload; defaults applied on create only; auto-slug derives,
  normalises and does not overwrite; hooks receive `overrideAccess`; `handleFile` 200/404/400.
- `packages/core`: `slugify` unit tests (accents, punctuation, collapsing, trimming).
- `packages/db` + `@forge-cms/testing`: timestamps asserted by the shared contract suite.
- `packages/cloudflare`: custom binding names for both adapters.
- `apps/demo-aesthetics`: existing 18 content-model tests must pass **after** the workarounds are
  deleted, plus the demo's own regression test for finding 19 is inverted (a trusted create now
  keeps `status: 'confirmed'`).
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Acceptance criteria

1. `depth: 1` returns the media document for an `upload` field.
2. A `select` with `defaultValue: 'pending'` stores `'pending'` when the body omits it.
3. `defineField.slug({ autoGenerate: true, sourceField: 'name' })` fills the slug with no hook.
4. A hook can distinguish `overrideAccess: true` from an anonymous request.
5. `new R2StorageAdapter({ binding: 'MEDIA' })` initialises from `env.MEDIA`.
6. Records created through `InMemoryDatabaseAdapter` carry `created_at`/`updated_at`.
7. `GET` on a stored file's URL returns the bytes with the right content type.
8. `apps/demo-aesthetics` no longer contains `uploads.ts`, the slug hooks, or the URL-rewrite hook.
9. Gates green.

## Open questions

None.

## Outcome

Shipped as specified. Seven findings closed; the demo lost ~120 lines of workaround code and its
`FINDING` comments now point at what fixed them.
