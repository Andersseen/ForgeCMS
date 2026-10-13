# @forge-cms/api

The transport contract between a web framework and ForgeCMS: `ApiContext` (a standard `Request`, route `params` and
your `env`) and the CRUD handler types. The handlers themselves live in `@forge-cms/runtime`; this package holds the
types so adapters and framework glue can depend on them without pulling in the runtime.

**Who needs it:** server code that mounts Forge handlers into Nitro/h3, Hono, a Worker or any framework that can
produce a Web `Request`. **Boundary:** types and a small helper; server only.

```sh
pnpm add @forge-cms/api
```

```ts
import type { ApiContext } from '@forge-cms/api';
import { handleList, type ForgeCmsRuntime } from '@forge-cms/runtime';

export function listPosts(request: Request, runtime: ForgeCmsRuntime) {
  const context: ApiContext = { request, params: { collection: 'posts' }, env: undefined };
  return handleList(context, { runtime });
}
```

## Stable entry points

`ApiContext`, `CrudHandlerConfig`, `CrudHandlers`, `defineCrudHandlers`. Every handler returns a standard `Response`
with the stable envelope: list → `{ data, meta }`, item → `{ data }`, error → `{ error, details? }`, delete → `204`.

Reference: [docs/REFERENCE.md](../../docs/REFERENCE.md#forge-cmsapi) · REST contract: <https://forge-cms.pages.dev/docs/rest-api>
