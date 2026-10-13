# @forge-cms/core

The ForgeCMS schema DSL and runtime validation. Everything else — the database schema, the REST API, the
admin forms and the types your Angular app receives — is derived from the definitions you write with this
package.

**Who needs it:** every ForgeCMS project. **Boundary:** isomorphic (no Node or browser APIs); safe to import
as a _type_ from browser code, but keep the definitions themselves on the server so hooks and access rules
never reach a bundle.

```sh
pnpm add @forge-cms/core
```

```ts
import { defineCollection, defineField } from '@forge-cms/core';

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  fields: {
    title: defineField.text({ required: true }),
    body: defineField.richtext(),
    author: defineField.relation({ collection: 'users' })
  },
  access: { read: () => true, create: ({ user }) => user?.role === 'admin' }
});
```

## Stable entry points

- `defineCollection`, `defineGlobal`, `defineBlock`, `defineField.<kind>` — the 15 field kinds: `text`, `textarea`,
  `number`, `boolean`, `date`, `email`, `select`, `slug`, `json`, `richtext`, `relation`, `upload`, `group`, `array`,
  `blocks`.
- Access rules (`AccessFn`, `FieldAccess`), the nine collection hooks and the field hooks.
- `validateCollection` / `validateField` and the `ValidationError` shape (`required`, `type_<kind>`).
- Type inference: `CollectionData`, `CollectionInput`, `CollectionDocument`, `InferFields`.
- `slugify`, the identifier guards and the `ForgeLogger` hooks.

The complete list is the committed export baseline (`api-baseline/_forge-cms_core.json`); options and defaults are in
the [reference](../../docs/REFERENCE.md#forge-cmscore) and the [field matrix](../../docs/MATRICES.md#field-support-matrix).

## Compatibility

ESM only, Node >= 22, TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` are supported).
Versioned together with the other ten public packages — see [support](../../docs/SUPPORT.md).

Docs: <https://forge-cms.pages.dev/docs/collections> · <https://forge-cms.pages.dev/docs/fields>
