# 022 — Composite fields: group, array and blocks

- **Status:** done
- **Author:** agent draft
- **Date:** 2026-07-22
- **Branch:** main
- **Affected packages/apps:** @forge-cms/core, @forge-cms/db, @forge-cms/runtime, @forge-cms/angular, @forge-cms/admin, apps/www

## Context / Why

`FieldMap` was `Record<string, AnyField>` where every one of the 12 kinds was a flat scalar, stored
one column per field. That makes ForgeCMS a typed CRUD layer, not a content model: there was no way
to express a repeating list, a nested object, or a page composed of heterogeneous sections.

`blocks` in particular is the primitive page-builder CMSs are chosen for. Without it ForgeCMS
competes with Directus rather than with Payload — and every field kind added on top of the flat model
is work that would have to be redone once nesting arrives. Hence: last in Phase 1, but in Phase 1.

## Goal

A collection can declare nested, repeating and heterogeneous-repeating fields, and they validate,
persist and render like any other field.

## Non-goals

- **Join-table storage.** Composite values are one JSON document in a TEXT column. Join tables would
  only buy querying _inside_ nested data, which nothing needs, and cost a migration story this
  project does not have.
- **Querying inside composite values.** `where` cannot reach `sections.0.heading`.
- **Field hooks on nested fields** (spec 021 covers top-level fields only).
- **A precise discriminated union for block rows.** Rows are `BlockValue`; narrowing on `blockType`
  is the consumer's job. A real union here makes the recursive field types unresolvable.
- Drag-to-reorder in the admin UI. Rows can be added and removed, not reordered.

## Design

### Kinds

```ts
interface GroupFieldOptions  extends BaseFieldOptions { fields: FieldMap }
interface ArrayFieldOptions  extends BaseFieldOptions { fields: FieldMap; minRows?: number; maxRows?: number }
interface BlocksFieldOptions extends BaseFieldOptions { blocks: BlockDefinition[]; minRows?: number; maxRows?: number }

type BlockValue = Record<string, unknown> & { blockType: string };

defineBlock({ slug, label?, fields })
```

`defineField.group`/`array` are generic over their nested `FieldMap`, so inference survives nesting:

```ts
seo: defineField.group({ fields: { metaTitle: defineField.text() } });
// CollectionData<...>['seo'] is { metaTitle: string }
```

`CollectionData<C>` is now `InferFields<C['fields']>`, and `InferFields` is reused for nested maps.

### Validation

`validateFieldMap(fields, data, pathPrefix)` is the recursion point. Error paths are dotted and
index-addressed so a client can attach a message to the exact control: `seo.metaTitle`,
`highlights.0.label`, `sections.1.body`. New codes: `type_group`, `type_array`, `type_blocks`,
`minRows`, `maxRows`, `block_type`. A `blocks` row with an unknown `blockType` reports the valid
slugs in its message.

### Storage

`fieldKindToSqlType` maps all three to `TEXT`; `toDbValue`/`fromDbValue` JSON-serialise and parse
them, exactly like `json` and `richtext`. An unparseable stored value is returned as-is rather than
throwing. `generateAddColumnSql` covers them, so adding a composite field to an existing collection
is an ordinary additive migration.

### Client metadata

`FieldMeta` gains `fields?`, `blocks?`, `minRows?`, `maxRows?`. The serialisation moved out of
`apps/www`'s route and into `@forge-cms/runtime`'s `describeCollections()` — the route is now three
lines, and the recursion lives with the schema.

### Admin UI

New `ForgeFieldControlComponent` renders **one** field and recurses into itself for composite kinds
(self-referenced via `forwardRef`, which is how a standalone component imports itself without hitting
the class's temporal dead zone). Values flow strictly upward: a nested control emits its new value,
the owning composite branch merges it into a fresh object/array and re-emits. Nothing mutates a
parent's state, so the form value stays a plain immutable object.

`ForgeCollectionFormComponent` now just maps its fields to that control, and no longer coerces
values on submit — the controls emit already-typed values.

## Implementation plan

- [x] Core: kinds, options, `defineBlock`, `InferFields`, generic `defineField.group/array/blocks`
- [x] Core: `validateFieldMap` + recursive validation with dotted paths
- [x] db: TEXT mapping and JSON round-trip in the schema generator
- [x] runtime: `describe.ts` recursive metadata + thin collections route
- [x] angular: `FieldMeta.fields`/`blocks`/`minRows`/`maxRows`, `BlockMeta`
- [x] admin: `ForgeFieldControlComponent`, simplified `ForgeCollectionFormComponent`
- [x] apps/www: `landing_pages` demo collection exercising all three
- [x] Tests; changeset

## Test plan

- `packages/core/src/composite-fields.test.ts` — 18 cases: nested required rules, dotted error paths,
  row indices, `minRows`/`maxRows`, unknown `blockType`, per-block field validation, and a
  group→array→group nesting reporting `layout.rows.1.cell.label`.
- `packages/db/src/schema-generator.test.ts` — TEXT columns, JSON round-trip, additive ALTER.
- Manual against the dev server: create a `landing_pages` document over HTTP with all three kinds and
  read it back; submit an invalid one and confirm the error paths.

## Acceptance criteria

1. ✅ `group`, `array` and `blocks` validate recursively with addressable error paths.
2. ✅ Values round-trip through the database unchanged.
3. ✅ Type inference survives nesting.
4. ✅ The admin form renders arbitrary nesting and can add/remove rows and blocks.
5. ✅ `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Outcome

Shipped 2026-07-22. Verified against the running dev server: a `landing_pages` document with a group,
a 2-row array and 3 heterogeneous blocks round-tripped over HTTP, and an invalid payload returned
`highlights.0.label -> required` and `sections.0 -> block_type`.

Deferred (see Non-goals): nested field hooks, querying inside composite values, row reordering.
