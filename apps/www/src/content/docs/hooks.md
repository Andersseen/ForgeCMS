---
title: Hooks
description: The nine collection stages, field hooks, and what can and cannot fail a write.
group: Content modelling
order: 4
---

Hooks are arrays of functions on a collection. Every stage receives a context object and runs in
declaration order.

```ts
const bookings = defineCollection({
  slug: 'bookings',
  hooks: {
    beforeValidate: [({ data }) => ({ ...data, email: String(data.email ?? '').toLowerCase() })],
    beforeChange: [
      ({ data, operation, overrideAccess }) =>
        // Public submissions are always pending; our own server code may set whatever it likes.
        operation === 'create' && !overrideAccess ? { ...data, status: 'pending' } : data
    ],
    afterChange: [
      async ({ doc, operation }) => {
        if (operation === 'create') await notifyFrontDesk(doc);
      }
    ]
  },
  fields: {
    /* … */
  }
});
```

## The stages

| Stage             | Runs                               | Receives                                          | Returns                   |
| ----------------- | ---------------------------------- | ------------------------------------------------- | ------------------------- |
| `beforeOperation` | first, on every operation          | `{ collection, operation, user, overrideAccess }` | nothing (side effects)    |
| `beforeValidate`  | create / update, before validation | `+ { data, previousData? }`                       | the data to continue with |
| `beforeChange`    | create / update, after validation  | `+ { data, previousData? }`                       | the data to store         |
| `afterChange`     | create / update, after the write   | `+ { doc, result }`                               | nothing                   |
| `beforeRead`      | once per read, before the query    | `+ { query }`                                     | the query to run          |
| `afterRead`       | per document returned              | `+ { doc }`                                       | the document to return    |
| `beforeDelete`    | before a delete                    | `+ { id, doc }`                                   | nothing                   |
| `afterDelete`     | after a delete                     | `+ { id, doc }`                                   | nothing                   |
| `afterOperation`  | last, on every operation           | `+ { result }`                                    | nothing                   |

`afterChange` also gets `result` as an alias of `doc`, kept for backwards compatibility.

## Failing a write

**Before-hooks can reject.** Throw and the operation stops with `400` and your message:

```ts
beforeChange: [
  ({ data }) => {
    if (new Date(data.startsAt as string) < new Date()) {
      throw new Error('Cannot book a slot in the past');
    }
    return data;
  }
];
```

**After-hooks cannot.** `afterChange`, `afterDelete` and `afterOperation` run once the write is
already committed; a throw there is logged and swallowed, because failing the request would report a
write that actually happened as an error. Put anything that must be able to veto in a before-stage.

## Narrowing reads

`beforeRead` gets the query the operation is about to run and returns the query to actually run. It
merges with — rather than replaces — access-control constraints:

```ts
beforeRead: [({ query, user }) => (user ? query : { ...query, visibility: 'public' })];
```

## Field hooks

Any field can carry its own hooks, which run inside the corresponding collection stage:

```ts
price: defineField.number({
  hooks: {
    beforeValidate: [({ value }) => Math.round(Number(value) * 100) / 100],
    afterRead: [({ value }) => Number(value)]
  }
});
```

| Field stage      | When                                                |
| ---------------- | --------------------------------------------------- |
| `beforeValidate` | create / update, before validation — normalise here |
| `beforeChange`   | create / update, after validation                   |
| `afterRead`      | every read, before the value reaches the caller     |

Each returns the value to use in place of `args.value`, and receives the whole `data` object plus
`previousValue` on update. Field hooks on **nested** composite fields are not run yet — only
top-level fields.

## `overrideAccess` in hooks

Every hook context carries `overrideAccess`. Without it a hook cannot distinguish a public request
from trusted server code, because both can arrive with `user: null`:

```ts
beforeChange: [
  ({ data, overrideAccess }) => (overrideAccess ? data : { ...data, status: 'pending' })
];
```

Check it in any hook that hardens public writes, or your seed script's deliberate values get
rewritten too.

## Ordering, end to end

```txt
create
  ├─ access check
  ├─ defaults (defaultValue, slug autoGenerate)
  ├─ beforeOperation
  ├─ beforeValidate (collection) → beforeValidate (fields)
  ├─ validate
  ├─ beforeChange (collection) → beforeChange (fields)
  ├─ write
  ├─ afterChange
  └─ afterOperation

find
  ├─ access check → query constraint
  ├─ beforeOperation
  ├─ beforeRead (may narrow the query)
  ├─ query + count
  ├─ populate relations (depth: 1)
  ├─ field read access filtering
  ├─ afterRead (per doc) → afterRead (fields)
  └─ afterOperation
```

Both the Local API and the HTTP layer run this same pipeline — hooks fire identically whether the
call came from a route or from your own server code.
