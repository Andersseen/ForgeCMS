# 015 — Add a `richtext` field kind

- **Status:** done
- **Author:** agent draft (approved via user instruction to implement the Payload-parity roadmap)
- **Date:** 2026-07-20
- **Branch:** main
- **Affected packages/apps:** @forge-cms/core, @forge-cms/db

## Context / Why

`@forge-cms/core` has 10 field kinds but no rich text — a CMS field for body copy with basic formatting
(bold/italic, headings, links, lists), which is close to table-stakes for a "Payload-like CMS". STATE.md
lists "richtext" as a missing field kind under both `@forge-cms/core` and the "What's next" list.

## Goal

`defineField.richtext(options)` produces a new field kind whose value is a structured document (an array
of block nodes), validated by `validateField`, and stored as JSON text by the SQL adapters — the same
storage pattern the existing `json` field kind already uses.

## Non-goals

- A WYSIWYG editor component in `@forge-cms/admin` (this spec ships the schema/validation/storage layer
  only, matching how the other 9 field kinds shipped before their own admin form widgets existed —
  `@forge-cms/admin`'s `ForgeCollectionFormComponent` already has a fallback path for field kinds it
  doesn't have a dedicated widget for, so richtext degrades to that rather than breaking the form).
- A fixed vocabulary of node `type` values or marks — the node shape is intentionally open (`type: string`,
  arbitrary extra properties) so consumers can define their own block/mark set, matching how Slate/Lexical
  document schemas work (structurally validated, not semantically restricted).
- Markdown/HTML serialization or conversion helpers.
- Rich-text-aware diffing, sanitization, or XSS-safe rendering helpers — a consumer rendering this content
  as HTML is responsible for its own escaping, same as it already is for `json`/`text` fields today.

## Design

### `@forge-cms/core` — new field kind

```ts
export interface RichTextNode {
  type: string;
  text?: string; // leaf/text nodes
  children?: RichTextNode[]; // block/element nodes
  [extra: string]: unknown; // marks (bold, italic, ...) and node-specific data (level, href, ...)
}

export type RichTextContent = RichTextNode[]; // a document: an array of top-level block nodes

export type RichTextFieldOptions = BaseFieldOptions;
export type RichTextField = FieldDefinition<'richtext', RichTextContent, RichTextFieldOptions>;

// FieldKind gains 'richtext'; AnyField gains RichTextField; defineField gains .richtext(options?)
```

### `@forge-cms/core` — `validateField` case `'richtext'`

A valid value is an array; each node in the tree (recursing into `children`) must be a plain object with a
string `type`, and either a string `text` or an array `children` (or neither, for void/leaf element nodes
like a horizontal rule — only reject values that are structurally wrong, e.g. `type` missing/non-string,
`text` present but non-string, `children` present but not an array). New `ValidationErrorCode` values:
`'type_richtext'` (not an array / a node isn't a valid node shape).

### `@forge-cms/db` — storage

`fieldKindToSqlType`: `'richtext'` → `'TEXT'` (same bucket as `json`/`text`/etc.). `toDbValue`: JSON-stringify
(same as `json`). `fromDbValue`: JSON-parse, falling back to the raw value on parse failure (same as
`json`).

## Implementation plan

- [x] `packages/core/src/index.ts`: `RichTextNode`, `RichTextContent`, `RichTextFieldOptions`,
      `RichTextField`; extend `FieldKind`/`AnyField`; `defineField.richtext`.
- [x] `packages/core/src/validation.ts`: `'richtext'` case in `validateField`; `'type_richtext'` error code.
- [x] `packages/db/src/schema-generator.ts`: `'richtext'` in `fieldKindToSqlType`/`toDbValue`/`fromDbValue`.
- [x] Tests: `packages/core/src/validation.test.ts` (valid document, non-array rejected, node missing
      `type` rejected, nested `children` validated recursively, node with only `text` and no `children` is
      valid, node with neither is valid i.e. void nodes allowed); `packages/db/src/schema-generator.test.ts`
      (SQL type + round-trip through `toDbValue`/`fromDbValue`).
- [x] `docs/ARCHITECTURE.md` / `docs/STATE.md`: document the new field kind; update `@forge-cms/core` row.
- [x] Changeset: `@forge-cms/core`, `@forge-cms/db` (minor — additive).

## Test plan

- `validation.test.ts`: `[{ type: 'paragraph', children: [{ type: 'text', text: 'Hello' }] }]` is valid;
  a bare string/object (not an array) is rejected; `[{ children: [] }]` (missing `type`) is rejected;
  `[{ type: 'paragraph', children: [{ type: 'text', text: 123 }] }]` (non-string `text`) is rejected;
  `[{ type: 'divider' }]` (no `text`/`children`) is valid.
- `schema-generator.test.ts`: `fieldKindToSqlType` for a richtext field is `'TEXT'`; a document round-trips
  through `toDbValue`/`fromDbValue` unchanged (deep-equal).

## Acceptance criteria

1. `defineField.richtext()` and a `defineCollection` using it type-check and pass `validateField`/
   `validateCollection` for a well-formed document.
2. A structurally invalid value (non-array, or a node missing `type`) fails validation with a
   `'type_richtext'` error.
3. A richtext value round-trips through `toDbValue`/`fromDbValue` (and, transitively, through
   `LibSqlDatabaseAdapter`/`D1DatabaseAdapter`'s existing JSON-text storage path) unchanged.
4. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Open questions

(none — approved)

## Outcome

Shipped 2026-07-20 as specified, no divergence. `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
green, including a full monorepo build confirming no downstream package's `switch (field.kind)` needed
updating (none had exhaustiveness checks that would break on a new kind).
