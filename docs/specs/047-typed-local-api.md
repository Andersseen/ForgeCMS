# 047 — Typed Local API

- **Status:** done
- **Author:** agent draft from maintainer feature brief
- **Date:** 2026-08-27
- **Branch:** main
- **Affected packages/apps:** @forge-cms/core, @forge-cms/runtime

## Context / Why

`CollectionDefinition<TSlug, TFields>`, `FieldValue`, `InferFields`, and `CollectionData` already carry
full schema-level type information, but it is lost at the runtime boundary: `ForgeCmsConfig.collections`
is `CollectionDefinition[]` (widened), and every Local API method (`find`/`findByID`/`count`/`create`/
`update`/`delete`) takes `collection: string` and `data: Record<string, unknown>`, returning
`DatabaseRecord` (`Record<string, unknown>`). A consumer gets no autocomplete on collection slugs, no
compile-time check that `data` matches the collection's fields, and no typed shape on the document that
comes back — despite the schema being fully known at the call site. Phase 1 (spec 019, Local API) and
spec 046 (schema integrity) are done; this is a pure TypeScript/DX improvement layered on top, with
**zero runtime behavior change**.

## Goal

`ForgeCmsRuntime` preserves the registered collection schemas as a type parameter, so `find`/`findByID`/
`count`/`create`/`update`/`delete` (and `preview`) infer typed collection slugs, typed write payloads,
and typed returned documents, while existing untyped/broad consumers, all adapters, and the HTTP handler
layer keep compiling and behaving exactly as before.

## Non-goals

- Any runtime behavior change. `packages/runtime/src/operations.ts` is not modified.
- A second/fluent Local API (`cms.collection('posts').find()`). The existing method shapes stay.
- Pushing generics into `DatabaseAdapter`/`D1DatabaseAdapter`/`LibSqlDatabaseAdapter`/
  `InMemoryDatabaseAdapter` — they keep working on plain `DatabaseRecord`.
- Typing `getCollection`/`getCollections`/`getGlobal`/`getGlobals`/`init`/`syncSchema`, globals ops,
  versions ops, hooks, access rules, localization internals, or HTTP handler exports — only a small,
  load-bearing change lands in `handlers.ts`/`files.ts` (see Design), nothing else there changes.
- A full type-level model of `required`/defaults/auto-generated values. `CollectionInput` is a plain
  `Partial<CollectionData<...>>`; runtime validation stays the authority on what a write actually needs.
- Deep typing of every `where` operator or nested and/or queries — only field names (`where` keys,
  `sort`) are constrained to known collection/document keys.
- Runtime (Zod or similar) validation of a consumer-supplied JSON generic. `defineField.json<T>()` is a
  compile-time annotation only.
- Machine authentication (API keys, scopes) — intentionally the next branch after this one.

## Design

### Why this needs a real design pass, not just "add generics"

Prototyped directly against `tsc` (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)
before writing any repo code, because two things are genuinely tricky here and wrong assumptions would
have meant reworking the whole PR:

1. **Constructor inference.** Does `new ForgeCmsRuntime({ collections: [posts, authors], adapters })`
   actually infer a literal-slug-preserving type for `collections` without `as const` anywhere? Confirmed
   yes — both for an inline array literal and for the repo's actual pattern
   (`const collections = [posts, authors]` declared separately, then passed by name, as in every real
   call site in this repo). A plain array-of-a-union type gives the same `CollectionSlug`/`CollectionBySlug`
   result as a true tuple would, since both are indexed with `[number]`.
2. **The HTTP-handler assignability problem.** `packages/runtime/src/handlers.ts`'s `HandlerOptions<TEnv>`
   currently types `runtime: ForgeCmsRuntime<TEnv>`, and every real app (`apps/www`, `apps/demo-aesthetics`)
   passes a runtime built from its own concrete collection list into handler functions with dynamic,
   request-time collection slugs (plain `string`, not a literal). Once `find`/`create`/etc. become generic
   methods returning a collection-shaped type, TypeScript's structural comparison of two **concrete**
   instantiations of `ForgeCmsRuntime<Env, ...>` (the app's narrow one vs. `HandlerOptions`'s own broad
   default) fails on return-type covariance — confirmed with a full prototype reproducing this exact shape,
   which threw `TS2322` on the mismatch between a finite-keyed document type and the broad fallback's
   index-signature-shaped one. Fixed by pinning the **two outermost HTTP-boundary types only**
   (`HandlerOptions.runtime`, `FileHandlerOptions.runtime`) to `ForgeCmsRuntime<TEnv, any>` instead of the
   class's own broad-but-concrete default — confirmed this one pin is sufficient (nothing downstream
   inside `handlers.ts`/`files.ts` needs to change) because once a value's static type is the `any`-pinned
   alias, it stays freely assignable into any further instantiation of the same class.
3. **The same assignability problem, discovered again mid-implementation, in this package's own test
   suite.** The prototyping above used `CollectionBySlug<TCollections, TSlug> = Extract<TCollections[number],
{ slug: TSlug }> extends never ? CollectionDefinition<TSlug, FieldMap> : Extract<...>` — a conditional
   type over the still-generic `TSlug` — to give the broad-registry-plus-literal-argument case a sane
   fallback instead of `never`. That conditional is _deferred_ (TypeScript can't resolve it without a
   concrete `TSlug`), and a deferred conditional type in a method's return position turned out to break
   the exact same class-instantiation comparison as point 2 above, but far more widely: every
   `packages/runtime/src/*.test.ts` file that writes `let runtime: ForgeCmsRuntime; runtime =
createTestRuntime();` (the dominant pattern in this package's own tests) failed to compile once
   `find`'s return type went through that conditional. Fixed by replacing the `Extract`+conditional with
   a key-remapped mapped type (`{ [TCollection in TCollections[number] as TCollection['slug']]:
TCollection }`) plus a plain indexed-access lookup wrapped in an `extends infer TCollection extends
CollectionDefinition ? TCollection : never` clause (to satisfy the downstream generic constraint) —
   this still gives the same graceful broad-registry fallback (a non-literal key produces an
   index-signature type instead of `never`) without ever deferring a conditional type over `TSlug`, and
   the pervasive test-file breakage disappeared with no test file needing to change. See the Outcome
   section for what this meant for the original implementation plan.

### Schema-level type utilities (`@forge-cms/core`)

Added to `packages/core/src/index.ts`, next to `CollectionData`, reusing `InferFields`/`FieldValue`/
`CollectionData` rather than building a parallel type system:

```ts
/**
 * An ordered/unordered set of registered collections, as `ForgeCmsConfig.collections` carries it.
 * Mutable (not `readonly`) to match `DatabaseAdapter.syncSchema`'s existing parameter type —
 * `CollectionSlug`/`CollectionBySlug` index with `[number]` either way, so this doesn't cost
 * anything for tuple-shaped inference.
 */
export type CollectionRegistry = CollectionDefinition[];

/** The union of registered collection slugs. `string` when the registry itself is untyped/broad. */
export type CollectionSlug<TCollections extends CollectionRegistry> = TCollections[number]['slug'];

/**
 * Registered collections keyed by slug. For a broad/untyped registry, key-remapping over a
 * non-literal slug type produces an index-signature type rather than a `never`-prone `Extract` —
 * that's what lets `CollectionBySlug` fall back gracefully instead of resolving to `never`, and
 * (unlike `Extract<...> extends never ? ... : ...`) a plain indexed-access lookup here never turns
 * into a deferred conditional type — see point 3 above for why that distinction mattered.
 */
type CollectionMap<TCollections extends CollectionRegistry> = {
  [TCollection in TCollections[number] as TCollection['slug']]: TCollection;
};

/** The specific collection definition for one slug. */
export type CollectionBySlug<
  TCollections extends CollectionRegistry,
  TSlug extends CollectionSlug<TCollections>
> = CollectionMap<TCollections>[TSlug] extends infer TCollection extends CollectionDefinition
  ? TCollection
  : never;

/** Standard document metadata every stored record carries, alongside its declared fields. */
export interface DocumentMeta {
  id: string;
  created_at: string;
  updated_at: string;
}

/** The full typed shape of a stored document: declared fields plus standard metadata. */
export type CollectionDocument<TCollection extends CollectionDefinition> =
  CollectionData<TCollection> & DocumentMeta;

/** A typed create/update payload: any subset of the collection's declared fields. */
export type CollectionInput<TCollection extends CollectionDefinition> = Partial<
  CollectionData<TCollection>
>;
```

`defineField.json` becomes generic, default unchanged:

```ts
json<TValue = unknown>(options: JsonFieldOptions = {}): FieldDefinition<'json', TValue, JsonFieldOptions> {
  return createField<'json', TValue, JsonFieldOptions>('json', options);
}
```

`defineField.json()` still infers `unknown` exactly as today; `defineField.json<CatalogContent>()` carries
that type through `InferFields`/`CollectionData`/`CollectionDocument` like any other field. This is a
**type-only** annotation — no runtime shape validation is added (documented on the method).

### Registry-generic config and runtime (`@forge-cms/runtime`)

`packages/runtime/src/config.ts`:

```ts
export interface ForgeCmsConfig<
  TEnv = unknown,
  TCollections extends CollectionRegistry = CollectionDefinition[]
> {
  collections: TCollections;
  globals?: GlobalDefinition[];
  adapters: AdapterSet;
  env?: TEnv;
}
```

`packages/runtime/src/runtime.ts`: `ForgeCmsRuntime<TEnv = unknown, TCollections extends CollectionRegistry
= CollectionDefinition[]>`. `TCollections` defaults exactly like `TEnv` already does, so
`new ForgeCmsRuntime({ collections, adapters })` continues to compile with no annotation, and
`ForgeCmsRuntime<TEnv>` (one type argument) keeps compiling unchanged — TypeScript's constructor
inference fills `TCollections` from the `collections` property whenever it isn't pinned by an explicit
type argument. (Consumers who explicitly write `new ForgeCmsRuntime<Env>(...)` keep compiling exactly as
before, but — per TypeScript's own explicit-generic-argument rule, not a choice made here — lose
collection-slug narrowing, same as they have today; passing both type arguments,
`new ForgeCmsRuntime<Env, typeof collections>(...)`, restores it. This is called out explicitly rather
than left to be discovered, since it's the one corner where "preserve `ForgeCmsRuntime<TEnv>`
compatibility" and "always fully typed" can't both hold — TypeScript has no partial-inference story here.)

A small isolated file, `packages/runtime/src/typed-api.ts`, holds the generic arg/result type wiring so
`operations.ts` stays untouched and `runtime.ts`'s method bodies stay a one-line delegate-and-cast each:

```ts
export type TypedSortField<TCollection extends CollectionDefinition> = Extract<
  keyof CollectionDocument<TCollection>,
  string
>;

export type TypedWhere<TCollection extends CollectionDefinition> = Partial<
  Record<TypedSortField<TCollection>, WhereCondition>
>;

export type TypedFindArgs<
  TCollections extends CollectionRegistry,
  TSlug extends CollectionSlug<TCollections>
> = Omit<FindArgs, 'collection' | 'where' | 'sort'> & {
  collection: TSlug;
  where?: TypedWhere<CollectionBySlug<TCollections, TSlug>>;
  sort?: TypedSortField<CollectionBySlug<TCollections, TSlug>>;
};

// ...TypedFindByIDArgs / TypedCountArgs / TypedCreateArgs / TypedUpdateArgs / TypedDeleteArgs /
// TypedPreviewArgs / TypedPaginatedDocs follow the same Omit-and-narrow shape.
```

`runtime.ts`'s methods:

```ts
find<TSlug extends CollectionSlug<TCollections>>(
  args: TypedFindArgs<TCollections, TSlug>
): Promise<TypedPaginatedDocs<TCollections, TSlug>> {
  return operations.find(this, args as FindArgs) as Promise<TypedPaginatedDocs<TCollections, TSlug>>;
}
// findByID / count / create / update / delete / preview: same shape — untyped args in
// (structurally always safe, since a narrower `args` type widens fine into the untyped one),
// one cast on the way out (justified: the untyped operation genuinely returns the right shape at
// runtime, `operations.ts` just doesn't carry the type to prove it).
```

`getCollection`/`getCollections`/`getGlobal`/`getGlobals`/`init`/`syncSchema`, `getGlobalDocument`/
`updateGlobalDocument`, and the versions methods are **not** touched — they keep returning the broad
`CollectionDefinition`/`DatabaseRecord`/`Version` types, per the non-goals above. `preview` gets the same
light typing as `create`/`update` (collection slug + `CollectionInput` data + `CollectionDocument`
result) since it fits the same shape with no extra generic machinery.

### The HTTP-handler boundary fix

`packages/runtime/src/runtime.ts` exports one additional alias next to the class:

```ts
/**
 * The HTTP-transport-facing view of a runtime. Collection slugs at this boundary are plain runtime
 * strings from a URL and can never be statically narrowed, so this pins the registry to `any` rather
 * than the class's own concrete broad default. Assigning a genuinely-typed `ForgeCmsRuntime<Env,
 * MyCollections>` instance into `ForgeCmsRuntime<Env>` (i.e. `ForgeCmsRuntime<Env, CollectionDefinition[]>`)
 * fails TypeScript's structural check of the typed methods' return types; assigning it here does not,
 * and nothing downstream needs to change once a value's static type is this alias.
 */
export type AnyForgeCmsRuntime<TEnv = unknown> = ForgeCmsRuntime<TEnv, any>;
```

`handlers.ts`'s `HandlerOptions.runtime` and `files.ts`'s `FileHandlerOptions.runtime` change from
`ForgeCmsRuntime<TEnv>` to `AnyForgeCmsRuntime<TEnv>`. Nothing else in either file changes — every
internal helper (`authorize`, `resolveOptionalUser`, `resolveRequest`, `resolveGlobalRequest`) keeps its
existing `ForgeCmsRuntime<TEnv>` parameter type and keeps compiling, because a value already typed as the
`any`-pinned alias is freely assignable into any further instantiation of the same class. This is the one
`handlers.ts`/`files.ts` change in the whole branch — transport stays untyped, as intended.

### Query typing

`sort` and `where` keys are constrained to `Extract<keyof CollectionDocument<TCollection>, string>` (the
collection's declared fields plus `id`/`created_at`/`updated_at`), so `sort: 'doesNotExist'` or
`where: { doesNotExist: 'x' }` are compile errors. `where` **values** stay `WhereCondition` (unknown-ish) —
per-operator/per-field-type value checking is out of scope (non-goals).

### Backward compatibility, concretely

- `new ForgeCmsRuntime({ collections, adapters })` with `collections` built via `CollectionDefinition[]`
  (explicitly widened on purpose, or built dynamically) still compiles: `CollectionSlug`/`CollectionBySlug`
  fall back to `string` / a broad `CollectionDefinition<string, FieldMap>`, so every method still accepts
  any string and returns a loosely-typed (but not `any`) document — strictly better than today's
  `DatabaseRecord`, never worse.
- `apps/www` and `apps/demo-aesthetics` construct their runtimes as `new ForgeCmsRuntime<ServerEnv>({...})`
  today (explicit `TEnv` only) — per the constructor-inference note above, this keeps compiling unchanged
  and keeps returning the same broad types it already effectively has today; this branch does not change
  either app's runtime construction, since doing so is optional DX polish, not required for correctness,
  and out of scope per the non-goals ("do not over-type unrelated surfaces").

## Implementation plan

- [x] `@forge-cms/core`: `defineField.json<TValue = unknown>()`; `CollectionRegistry`, `CollectionSlug`,
      `CollectionBySlug`, `DocumentMeta`, `CollectionDocument`, `CollectionInput` added to
      `packages/core/src/index.ts`, exported from the package.
- [x] `@forge-cms/runtime`: `ForgeCmsConfig<TEnv, TCollections>` in `config.ts`; new
      `packages/runtime/src/typed-api.ts` with the `Typed*Args`/`TypedPaginatedDocs`/`TypedWhere`/
      `TypedSortField` helpers; `ForgeCmsRuntime<TEnv, TCollections>` in `runtime.ts` with typed
      `find`/`findByID`/`count`/`create`/`update`/`delete`/`preview`, each delegating to the existing
      `operations.*` function with one isolated result cast; `AnyForgeCmsRuntime<TEnv>` exported from
      `runtime.ts`.
- [x] `@forge-cms/runtime`: `handlers.ts`'s `HandlerOptions.runtime` and `files.ts`'s
      `FileHandlerOptions.runtime` switch to `AnyForgeCmsRuntime<TEnv>`. No other line in either file
      changes.
- [x] Type tests: `packages/runtime/src/typed-local-api.test.ts` (Vitest, `expectTypeOf` +
      `@ts-expect-error`, verified for real by `pnpm typecheck` since `.test.ts` files are in each
      package's `tsconfig.json` `include`) covering every case in Test plan below.
- [x] External-consumer fixture: extend `scripts/verify-release.mjs`'s `verifyRuntimeConsumer` with a
      typed-JSON-generic collection and compile-time-only (never invoked) negative assertions, proving
      inference works through the packed public surface with no deep imports.
- [x] Docs: one concise typed example added to the Local API documentation
      (`apps/www/src/content/docs/local-api.md` or equivalent existing page).
- [x] Changeset (`minor` — this adds new public exports/generic capabilities, so `minor` fits better
      than the `patch` this repo's prior specs used for additive changes; see spec 046) +
      `docs/STATE.md` update + close this spec.

## Test plan

- `pnpm --filter @forge-cms/core test` / `typecheck`
- `pnpm --filter @forge-cms/runtime test` / `typecheck`
- New type-test coverage (compile-time, `expectTypeOf`/`@ts-expect-error`):
  1. collection slug inference (`'posts' | 'authors'`, not `string`)
  2. `find()` result inference (`page.docs[0].title` types as `string`)
  3. `findByID()` result inference
  4. `create()` data typing (correct fields/types accepted)
  5. `update()` data typing (partial, correct fields/types accepted)
  6. `create`/`update`/`delete` return typing (typed document, including `id`/`created_at`/`updated_at`)
  7. invalid collection rejected (`@ts-expect-error`)
  8. invalid field value rejected (`@ts-expect-error`)
  9. typed JSON field (`defineField.json<T>()` carries `T` through)
  10. untyped JSON field remains `unknown`
  11. broad/backward-compatible runtime (`CollectionDefinition[]`) still compiles and still accepts any
      collection string
- `node scripts/verify-release.mjs` (or `pnpm release:verify`) — packed-artifact external consumer proves
  the same inference through public exports only.
- Full gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, `pnpm format:check`.
- Manual: confirm `apps/www` and `apps/demo-aesthetics` still `pnpm typecheck`/`pnpm build` clean
  unmodified (proves the `AnyForgeCmsRuntime` fix actually holds against real, not prototyped, code).

## Acceptance criteria

1. `ForgeCmsRuntime` preserves registered collection types (slug + fields) through a `TCollections`
   type parameter, defaulting to today's broad `CollectionDefinition[]`.
2. Collection names autocomplete on `find`/`findByID`/`count`/`create`/`update`/`delete`/`preview`, and
   an invalid collection name is a compile error, when `TCollections` is inferred from a concrete
   registry.
3. `find()`/`findByID()` return the inferred document type (declared fields + `id`/`created_at`/
   `updated_at`).
4. `create()`/`update()` reject unknown fields and wrong field value types at compile time.
5. Created/updated/deleted documents are typed the same way as read results.
6. `defineField.json<TValue>()` carries a consumer-provided type through `CollectionData`/
   `CollectionDocument`; `defineField.json()` still infers `unknown`.
7. Existing broad/untyped consumers (`CollectionDefinition[]`, or `ForgeCmsRuntime<TEnv>` with only
   `TEnv` given) keep compiling with no changes required.
8. No generic redesign in `DatabaseAdapter`/`D1DatabaseAdapter`/`LibSqlDatabaseAdapter`/
   `InMemoryDatabaseAdapter`.
9. External-consumer packaging fixture (`scripts/verify-release.mjs`) demonstrates the same inference
   through packed public exports only, no deep imports.
10. Runtime behavior is unchanged: `operations.ts` is not modified; existing runtime test suites pass
    unmodified.
11. Local API documentation shows one typed example (`defineCollection` → `find`/`create`/`update`
    inference).
12. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (and `format:check`) all green, including
    `apps/www` and `apps/demo-aesthetics` unmodified.

## Open questions

None — this spec transcribes an already-approved maintainer feature brief. Two of the three genuinely
open design questions it raised (constructor inference without `as const`, and the HTTP-handler
assignability problem) were resolved by prototyping against the real `tsc` settings before writing this
spec; a third instance of the same underlying assignability problem (this package's own test suite, not
just the HTTP boundary) surfaced only once real code hit real `tsc`, per SDD.md's "if reality contradicts
the spec, update it" — resolved the same day, recorded in Design point 3 above, no scope change.

## Outcome

Shipped as designed, with one real mid-implementation correction (Design point 3): the initial
`CollectionBySlug` fallback (`Extract<...> extends never ? ... : ...`) broke the dominant
`let runtime: ForgeCmsRuntime; runtime = createTestRuntime();` pattern used throughout
`packages/runtime/src/*.test.ts` — a much wider blast radius than the HTTP-handler case alone. Fixed by
replacing it with a key-remapped mapped type (`CollectionMap`) plus a plain indexed-access lookup, which
gives the identical graceful broad-registry fallback without ever deferring a conditional type over the
still-generic `TSlug`. After that fix, **zero test files needed any change** — the fix lived entirely in
`@forge-cms/core`'s type definitions.

- `ForgeCmsRuntime<TEnv, TCollections>` (default `TCollections = CollectionDefinition[]`, matching
  `TEnv`'s existing default pattern) preserves the registered collection schemas; `find`/`findByID`/
  `count`/`create`/`update`/`delete`/`preview` are now generic methods inferring typed collection slugs,
  typed write payloads (`CollectionInput`, a `Partial<CollectionData<...>>`), and typed returned
  documents (`CollectionDocument` — declared fields plus `id`/`created_at`/`updated_at`).
  `packages/runtime/src/typed-api.ts` holds all the `Typed*Args`/`TypedPaginatedDocs`/`TypedWhere`/
  `TypedSortField` generic wiring; `operations.ts` is byte-for-byte unmodified — every typed method is a
  one-line delegate-and-cast.
- `@forge-cms/core` gained `CollectionRegistry` (mutable, not `readonly` — matches
  `DatabaseAdapter.syncSchema`'s existing parameter type), `CollectionSlug`, `CollectionBySlug`,
  `DocumentMeta`, `CollectionDocument`, `CollectionInput`.
- `defineField.json<TValue = unknown>()` is generic; the untyped default is unchanged and no runtime
  validation was added, as designed.
- `sort`/`where` keys are constrained to `Extract<keyof CollectionDocument<TCollection>, string>`; `where`
  values stay loosely typed, per the non-goals.
- The HTTP-handler boundary fix landed exactly as designed: `AnyForgeCmsRuntime<TEnv>` (`ForgeCmsRuntime<
TEnv, any>`) exported from `runtime.ts`, used only by `HandlerOptions.runtime` (`handlers.ts`) and
  `FileHandlerOptions.runtime` (`files.ts`) — no other line in either file changed, and no internal helper
  (`authorize`, `resolveOptionalUser`, `resolveRequest`, `resolveGlobalRequest`) needed touching, because a
  value already typed as the `any`-pinned alias stays freely assignable into any further instantiation of
  the class.
- Backward compatibility verified against real code, not just prototypes: `apps/www` and
  `apps/demo-aesthetics` (both construct `new ForgeCmsRuntime<ServerEnv>({...})`, explicit-`TEnv`-only)
  needed **zero changes** and build/typecheck/test clean.
- Type tests: `packages/runtime/src/typed-local-api.test.ts` (Vitest `expectTypeOf` + `@ts-expect-error`,
  checked for real by `pnpm typecheck` since `.test.ts` files are in `tsconfig.json`'s `include`) covers
  every case in the Test plan; spot-verified load-bearing by temporarily deleting one `@ts-expect-error`
  line and confirming `tsc` then fails with a real `TS2322`, then restoring it.
- External-consumer verification: `scripts/verify-release.mjs`'s `verifyRuntimeConsumer` fixture extended
  with a second collection (`articles`) using `defineField.json<{ featured: boolean }>()`, typed
  create/find assertions that only compile if inference actually reached the packed public exports, and a
  never-invoked function holding the negative (`@ts-expect-error`) assertions. `pnpm release:verify` ran
  in full (packs and installs all 10 public packages into 3 isolated consumer projects) — printed
  `runtime consumer ok` and `Release verification passed.`
- Docs: `apps/www/src/content/docs/local-api.md` gained a "Typed inference" section (one example, plus a
  short note on the JSON generic being compile-time-only and on backward compatibility).
- Changeset: `minor` for `@forge-cms/core`/`@forge-cms/runtime` (new public exports/generic
  capabilities, unlike spec 046's `patch`); `pnpm changeset status` confirms it resolves cleanly.

Verification actually executed: `pnpm --filter @forge-cms/core build/typecheck/test` and
`pnpm --filter @forge-cms/runtime build/typecheck/test` individually while implementing; then the full
monorepo `pnpm build` (13/13 tasks), `pnpm typecheck` (23/23), `pnpm lint` (13/13, zero warnings — the one
deliberate `any` in `AnyForgeCmsRuntime` is suppressed with a targeted `eslint-disable-next-line` and a
justifying comment), `pnpm test` (23/23, including 225/225 in `@forge-cms/runtime`, all previously-passing
tests unmodified); then `pnpm release:verify` (full pass, all three consumer projects, angular-consumer's
one warning is pre-existing/unrelated). Machine auth (the next branch) was not started, per this spec's
non-goals.
