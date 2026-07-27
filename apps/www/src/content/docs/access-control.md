---
title: Access control
description: Collection rules, row-level query constraints, field-level rules, and roles.
group: Content modelling
order: 3
---

Access rules answer "may this user do this?" — and, when the answer is "only to some documents",
**which ones**.

## The two forms of a rule

```ts
const posts = defineCollection({
  slug: 'posts',
  access: {
    read: () => true, // anyone
    create: ['admin', 'editor'], // role list — sugar for "user's role is in this list"
    update: ({ user }) => (user ? { author: user.id } : false), // a query constraint
    delete: ['admin']
  },
  fields: {
    /* … */
  }
});
```

A rule is either a **list of role names** or a **function** returning:

| Return value | Meaning                                            |
| ------------ | -------------------------------------------------- |
| `true`       | Allowed, unrestricted                              |
| `false`      | Denied                                             |
| an object    | Allowed **only for documents matching this query** |

The function receives `{ user, operation, collection, id?, data?, doc? }` and may be async.

## Row-level rules are the point

Returning a query is what makes "authors edit only their own posts" and per-tenant isolation
expressible without writing the same `if` in every route:

```ts
access: {
  read: ({ user }) => (user?.role === 'admin' ? true : { tenantId: user?.tenantId ?? '' }),
  update: ({ user }) => (user ? { author: user.id } : false)
}
```

What the runtime does with that constraint:

- **on reads** it is AND-merged into the query — including the `totalDocs` count, so pagination
  never advertises documents you cannot see;
- **on update and delete** it is checked against the stored document;
- **a single read that the constraint excludes returns `404`, not `403`** — a 403 would confirm the
  document exists, which leaks ids.

## Field-level rules

Any field can carry its own `access`:

```ts
fields: {
  email: defineField.email({
    access: {
      read: ['admin'],           // filtered out of the response for everyone else
      write: ['admin']           // 403 if a non-admin tries to set it
    }
  }),
  internalNotes: defineField.textarea({
    access: { read: ({ user }) => user?.role !== 'viewer' }
  });
}
```

- `read` — the field is stripped from documents before they reach the caller.
- `write` — attempting to set it without permission fails the whole write with `403`.

Undefined means "no restriction beyond the collection rule".

## Roles

`@forge-cms/auth` ships three roles and helpers around them:

| Role     | Content                | Users        |
| -------- | ---------------------- | ------------ |
| `admin`  | full read/write        | manage users |
| `editor` | create / edit / delete | no           |
| `viewer` | read only              | no           |

```ts
import { isAdmin, canWriteContent, canManageUsers, userRole } from '@forge-cms/auth';
```

The same helpers are re-exported from `@forge-cms/angular` so the UI can hide what the backend would
refuse anyway.

## Two gates, not one

There are two independent checks on an HTTP write, and it is worth knowing which one rejected you:

1. **The route's `allowedRoles`** — a coarse gate configured where you mount the handler:

   ```ts
   return handleCreate(context, { runtime, allowedRoles: ['admin', 'editor'] });
   ```

2. **The collection's `access` rule** — the fine-grained one, evaluated inside the operation.

If a collection defines `access.create`, it overrides the route's static role check for that
operation; otherwise the route gate stands on its own.

## `overrideAccess`

Every Local API call takes `overrideAccess`:

```ts
// Trusted server code — access checks skipped (the default)
await runtime.create({ collection: 'posts', data });

// Acting on a request's behalf — checks enforced
await runtime.create({ collection: 'posts', data, user, overrideAccess: false });
```

The HTTP layer always passes `overrideAccess: false` plus the resolved user. **If you build a public
endpoint on the Local API, you must pass it yourself** — this is the single easiest way to
accidentally expose everything:

```ts
// A public site endpoint: run as a real anonymous visitor
const asVisitor = { overrideAccess: false, user: null } as const;
const { docs } = await runtime.find({ collection: 'services', ...asVisitor });
```

Hooks can see it too (`args.overrideAccess`), which is how a hook that hardens public writes ("force
`status` to `pending`") avoids also rewriting what your own seed script deliberately wrote.

## Status codes

| Situation                              | HTTP  |
| -------------------------------------- | ----- |
| Access denied, no authenticated user   | `401` |
| Access denied, authenticated           | `403` |
| Field-level write violation            | `403` |
| Document excluded by a read constraint | `404` |
