# 021 — Complete the hook pipeline, including field-level hooks

- **Status:** done
- **Author:** agent draft
- **Date:** 2026-07-22
- **Branch:** main
- **Affected packages/apps:** @forge-cms/core, @forge-cms/runtime

## Context / Why

Spec 013 shipped `beforeChange` and `afterChange` only. There was no way to derive a value on read,
normalise before validation, or guard a delete — all routine CMS requirements. With spec 019's Local
API there is now a single pipeline to hang the missing stages on, so this is cheap; leaving it until
the logic is spread across handlers again would not be.

## Goal

Every stage of the read, write and delete pipelines is interceptable, at collection and field level.

## Non-goals

- Hooks on nested fields inside `group`/`array`/`blocks`. Only top-level fields run field hooks.
- Global (cross-collection) hooks — that is the plugin system, roadmap item 030.
- Hook ordering configuration beyond array order.

## Design

```ts
interface CollectionHooks {
  beforeOperation?: BeforeOperationHook[]; // side effects, before access resolves
  beforeValidate?: BeforeValidateHook[]; // returns data; may reject
  beforeChange?: BeforeChangeHook[]; // returns data; may reject
  afterChange?: AfterChangeHook[]; // side effects
  beforeRead?: BeforeReadHook[]; // returns the query; runs once per operation
  afterRead?: AfterReadHook[]; // returns the doc; runs per document
  beforeDelete?: BeforeDeleteHook[]; // may reject — this is the point of it
  afterDelete?: AfterDeleteHook[]; // side effects
  afterOperation?: AfterOperationHook[]; // side effects, with the result
}
```

Field hooks live on `BaseFieldOptions.hooks`:

```ts
interface FieldHooks {
  beforeValidate?: FieldHook[];
  beforeChange?: FieldHook[];
  afterRead?: FieldHook[];
}
type FieldHook = (args: FieldHookArgs) => MaybePromise<unknown>; // returns the new value
```

### Failure semantics — deliberate asymmetry

**Before-hooks may reject.** A throwing `beforeValidate`/`beforeChange`/`beforeDelete` aborts the
operation and surfaces as 400 with the hook's own message. That is the entire purpose of
`beforeDelete` (referential-integrity guards, "this document is still in use").

**After-hooks may not.** `afterChange`/`afterDelete`/`afterOperation`/`beforeOperation` failures are
caught and logged. They run after the write is committed, so throwing would report failure for an
operation that actually succeeded — a webhook being down must not look like a failed save.

### Order

`beforeOperation → [field beforeValidate → beforeValidate] → validate → [field beforeChange →
beforeChange] → write → afterChange → [field afterRead → afterRead] → afterOperation`

### Backward compatibility

`afterChange` args carry both `doc` (the spec-021 name) and `result` (the spec-013 name), so hooks
written against either shape keep working. `HookContext` keeps its shape and gains an optional
`user`.

## Implementation plan

- [x] Core hook types
- [x] Rewrite `hooks.ts` with all nine collection stages + `runFieldHooks`
- [x] Wire the stages into `operations.ts`
- [x] `runRejectableStage` to preserve spec 013's 400-on-throw
- [x] Tests; changeset

## Test plan

`operations.test.ts`: an order-recording collection asserting the exact sequence; `beforeValidate`
deriving a slug that then satisfies a `required` rule; `beforeRead` narrowing a query; `afterRead`
computing a field; `beforeDelete` aborting a delete **and the document still being there afterwards**;
`afterDelete` receiving the removed document; a throwing `afterChange` not failing the write; field
`beforeChange`/`afterRead`.

## Acceptance criteria

1. ✅ All nine collection stages run in the documented order.
2. ✅ Before-hooks reject with 400; after-hooks log and continue.
3. ✅ Field-level hooks transform values on write and read.
4. ✅ Spec 013 hooks keep working unchanged.
5. ✅ `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Outcome

Shipped 2026-07-22.
