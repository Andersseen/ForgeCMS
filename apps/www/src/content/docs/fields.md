---
title: Fields
description: All 15 field kinds, their options, and how composite fields nest.
group: Content modelling
order: 2
---

Fields are created with `defineField.<kind>(options)`. Every kind accepts these base options:

| Option         | Type          | Meaning                                                                                                                      |
| -------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `label`        | `string`      | Admin UI label. Defaults to a humanised field name                                                                           |
| `required`     | `boolean`     | Enforced on every write by `validateCollection`                                                                              |
| `defaultValue` | `unknown`     | Applied on **create** when the incoming value is `undefined`                                                                 |
| `unique`       | `boolean`     | Single-field unique index. For a constraint spanning multiple fields, see [Collections § Indexes](/docs/collections#indexes) |
| `index`        | `boolean`     | Creates an index on the column                                                                                               |
| `access`       | `FieldAccess` | Per-field read/write rules — see [Access control](/docs/access-control)                                                      |
| `hooks`        | `FieldHooks`  | `beforeValidate` / `beforeChange` / `afterRead` — see [Hooks](/docs/hooks)                                                   |

## Scalar kinds

### `text`

```ts
defineField.text({ required: true, minLength: 3, maxLength: 120 });
```

### `textarea`

Same options as `text`; the admin renders a multi-line input.

### `number`

```ts
defineField.number({ min: 0, max: 5 });
```

### `boolean`

```ts
defineField.boolean({ defaultValue: false });
```

### `date`

```ts
defineField.date({ withTime: true });
```

Values are `Date` in TypeScript; the adapter stores an ISO string.

### `email`

`text` plus format validation.

### `select`

```ts
defineField.select({ options: ['draft', 'review', 'published'], defaultValue: 'draft' });
```

Values outside `options` fail validation. The admin renders a native select.

### `slug`

```ts
defineField.slug({ autoGenerate: true, sourceField: 'title' });
```

- A slug you supply is **normalised** (`"Láser & Piel"` → `laser-piel`) rather than rejected.
- With `autoGenerate: true` and no value, it is derived from `sourceField` — or from `title`/`name`
  if you do not name one.
- On update, an existing non-empty slug is **kept**: renaming a title does not silently break a URL.
  Clear the field explicitly to regenerate it.
- The same `slugify()` is exported from `@forge-cms/core`, so client-side previews match the server.

### `json`

An escape hatch: any JSON-serialisable value, stored in a `TEXT` column, validated only as
"serialisable". Prefer `group`/`array` when the shape is known — you get validation and a real
admin form.

### `richtext`

```ts
defineField.richtext();
```

The value is `RichTextContent` — an array of nodes, each with a `type`, optional `text`, optional
`children`, and open-ended extra keys for marks and node data. The format is deliberately close to
what Slate/Lexical-style editors produce.

```ts
const body: RichTextContent = [
  {
    type: 'paragraph',
    children: [
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'world', bold: true }
    ]
  }
];
```

The admin ships a block-level editor (`ForgeRichTextEditorComponent`) with a JSON fallback — not a
full WYSIWYG.

### `relation`

```ts
defineField.relation({ collection: 'categories' }); // one id
defineField.relation({ collection: 'tags', many: true }); // an array of ids
```

Stored as ids. Ask for `depth: 1` on a read and they are replaced with the referenced documents,
using **one batched query per relation field** — not one per document.

### `upload`

```ts
defineField.upload({ collection: 'media' });
```

Structurally a single `relation` pointing at an upload-enabled collection, but it tells the admin to
render a media picker and the client to expect file metadata. See [Uploads](/docs/uploads).

## Composite kinds

Composite values are stored as JSON in a single `TEXT` column and validated recursively. They cannot
be queried into — filtering happens on scalar columns only.

### `group`

A fixed set of nested fields, stored as one object:

```ts
address: defineField.group({
  fields: {
    street: defineField.text({ required: true }),
    city: defineField.text(),
    postcode: defineField.text()
  }
});
// → { street: string; city: string; postcode: string }
```

### `array`

A repeatable list of rows that all share one shape:

```ts
faqs: defineField.array({
  minRows: 1,
  maxRows: 10,
  fields: {
    question: defineField.text({ required: true }),
    answer: defineField.textarea({ required: true })
  }
});
// → { question: string; answer: string }[]
```

### `blocks`

The page-builder primitive: a repeatable list where each row picks one of several shapes,
discriminated by `blockType`.

```ts
import { defineBlock, defineField } from '@forge-cms/core';

const hero = defineBlock({
  slug: 'hero',
  label: 'Hero',
  fields: {
    headline: defineField.text({ required: true }),
    image: defineField.upload({ collection: 'media' })
  }
});

const richText = defineBlock({
  slug: 'richText',
  fields: { body: defineField.richtext() }
});

const pages = defineCollection({
  slug: 'pages',
  fields: {
    title: defineField.text({ required: true }),
    layout: defineField.blocks({ blocks: [hero, richText], minRows: 1 })
  }
});
```

Rows come back as `BlockValue` — `Record<string, unknown> & { blockType: string }`. They are
deliberately **not** a discriminated union: narrowing on `blockType` is a consumer-side concern, and
a precise union makes the recursive field types unresolvable.

```ts
for (const block of page.layout as BlockValue[]) {
  if (block.blockType === 'hero') {
    // narrow it yourself, e.g. with a type guard per block
  }
}
```

Nesting is arbitrary — a `group` inside an `array` inside a `blocks` row validates, and the admin's
`ForgeFieldControlComponent` recurses into itself to render it.

## Validation

Every write runs `validateCollection`, which returns errors shaped like:

```ts
{ field: 'title', message: 'title is required', code: 'required' }
```

Codes are `required` or `type_<kind>` (`type_text`, `type_number`, `type_relation`, …). Over HTTP
they arrive as `400 { error, details: ValidationError[] }`; through the Local API they are thrown as
`ValidationFailedError` carrying the same `details`.

Partial updates validate what you send: a required field already present on the stored record does
not have to be repeated in a `PUT` body.
