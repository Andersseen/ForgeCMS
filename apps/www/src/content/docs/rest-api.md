---
title: REST API
description: Endpoints, query parameters, response envelopes and status codes.
group: Server APIs
order: 2
---

The HTTP layer is transport only: it parses the query string, resolves the user, calls the
[Local API](/docs/local-api), wraps the result in an envelope and maps typed errors to status codes.

## Endpoints

| Method                | Path                      | Purpose                                       |
| --------------------- | ------------------------- | --------------------------------------------- |
| `GET`                 | `/api/v1/:collection`     | List documents                                |
| `POST`                | `/api/v1/:collection`     | Create (JSON, or multipart on `upload: true`) |
| `GET`                 | `/api/v1/:collection/:id` | Read one                                      |
| `PUT`                 | `/api/v1/:collection/:id` | Update (partial)                              |
| `DELETE`              | `/api/v1/:collection/:id` | Delete                                        |
| `GET`                 | `/api/v1/collections`     | Schema metadata for every collection          |
| `POST`                | `/api/auth/login`         | `{ email, password }` → `{ token, user }`     |
| `GET`                 | `/api/auth/me`            | The current user                              |
| `GET/POST/PUT/DELETE` | `/api/auth/users[/:id]`   | User management (admin only)                  |
| `GET`                 | `/api/status`             | Adapter / API health                          |

## Envelopes

```jsonc
// list
{ "data": [ /* … */ ], "meta": { "count": 10, "totalDocs": 42, "page": 1, "totalPages": 5, "hasNextPage": true, "hasPrevPage": false } }

// single item (create → 201)
{ "data": { "id": "…", "title": "…" } }

// delete → 204 No Content

// error
{ "error": "title is required", "details": [{ "field": "title", "message": "title is required", "code": "required" }] }
```

`meta.count` is the length of this page; `meta.totalDocs` is the total matching the query. Clients
(`@forge-cms/angular`, the admin UI) depend on this envelope — do not change it in a fork without
changing them.

## Query parameters

### Filtering

Any parameter that is not reserved is a filter. Bare `field=value` is equality; `field[op]=value`
names an operator. Values are coerced to the field's declared type.

```sh
curl "…/api/v1/products?category=facial"
curl "…/api/v1/products?price[gte]=50&price[lte]=200"
curl "…/api/v1/products?id[in]=a,b,c"
curl "…/api/v1/products?name[contains]=laser"     # case-insensitive
```

Operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in` (comma-separated), `contains`. An unknown
operator is a `400`.

### Sorting

```sh
curl "…/api/v1/posts?sort=publishedAt&order=desc"
```

One field only. It must be a declared field or one of `id`, `created_at`, `updated_at`; anything
else is a `400`. `order` must be `asc` or `desc`.

### Pagination

```sh
curl "…/api/v1/posts?limit=10&offset=20"
```

Read `meta.totalPages` / `meta.hasNextPage` rather than counting pages yourself.

### Relation population

```sh
curl "…/api/v1/posts?depth=1"
```

`depth=1` replaces relation and upload ids with the referenced documents (one batched query per
relation field). `0` and `1` are the only accepted values — multi-level population is not
implemented.

### Draft visibility

On a `drafts: true` collection:

```sh
curl "…/api/v1/posts"                # published only (public)
curl "…/api/v1/posts?status=draft"   # requires authentication
curl "…/api/v1/posts?status=all"     # requires authentication
```

Reserved parameter names — `limit`, `offset`, `sort`, `order`, `depth`, `status` — cannot be used as
filter field names.

## Authentication

```sh
TOKEN=$(curl -s -X POST …/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@forgecms.dev","password":"forgecms-demo"}' | jq -r .data.token)

curl …/api/v1/posts -H "Authorization: Bearer $TOKEN"
```

Send the token on **reads** too, not just writes: without it you are anonymous, which means no
drafts and field-level read rules resolve as "not logged in".

## Status codes

| Code  | When                                                               |
| ----- | ------------------------------------------------------------------ |
| `200` | OK                                                                 |
| `201` | Created                                                            |
| `204` | Deleted                                                            |
| `400` | Validation failed (`details`), malformed query, bad JSON/multipart |
| `401` | Authentication required, or access denied while unauthenticated    |
| `403` | Authenticated but not permitted (including field-level writes)     |
| `404` | Unknown collection or id — also an id an access rule hides         |
| `500` | Unexpected                                                         |

## Mounting the handlers

The routes are yours; the handlers are the package's. In Analog/Nitro:

```ts
// src/server/routes/api/v1/[collection].get.ts
import { defineEventHandler, getRouterParam, toWebRequest } from 'h3';
import type { ApiContext } from '@forge-cms/api';
import { handleList } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../api/runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const context: ApiContext = {
    request: toWebRequest(event),
    params: { collection: getRouterParam(event, 'collection') ?? '' },
    env: event.context.cloudflare?.env
  };
  return handleList(context, { runtime });
});
```

Handlers: `handleList`, `handleRead`, `handleCreate`, `handleUpdate`, `handleDelete`, plus
`handleFile` for stored bytes. Each takes `{ runtime, requireAuth?, allowedRoles? }`:

```ts
return handleCreate(context, { runtime, allowedRoles: ['admin', 'editor'] });
```

That role gate is coarse and route-level; a collection's own `access` rule overrides it for that
operation. Keep the routes thin — logic belongs in the Local API.

## Schema metadata

`GET /api/v1/collections` returns what the admin builds its forms from:

```jsonc
{
  "data": [
    {
      "slug": "posts",
      "name": "Posts",
      "drafts": true,
      "upload": false,
      "fieldDefinitions": [
        { "name": "title", "kind": "text", "label": "Title", "required": true },
        {
          "name": "category",
          "kind": "relation",
          "label": "Category",
          "required": false,
          "relation": { "collection": "categories", "many": false }
        }
      ]
    }
  ]
}
```

Composite fields carry their nested structure (`fields`, `blocks`, `minRows`, `maxRows`), which is
why the admin can render arbitrarily nested groups, arrays and blocks without knowing your schema at
build time.
