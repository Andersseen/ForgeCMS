---
title: Small project guide
description: Add ForgeCMS to a small Angular/Analog project — users, posts, cookie auth, and a working admin — end to end.
group: Getting started
order: 4
---

You have a small Angular/Analog project. You want users, a login, a protected admin, and a couple
of content types. This page is that path, start to finish — nothing here is aspirational: every
snippet is the same code proven by `apps/tiny-project` in this repository (spec 055), a
deliberately tiny external-style consumer built only on the public `@forge-cms/*` exports below.

## 1. Install

```sh
pnpm add @forge-cms/core @forge-cms/runtime @forge-cms/auth @forge-cms/db @forge-cms/storage \
  @forge-cms/angular @forge-cms/admin
```

Add the Cloudflare adapters only if you're deploying there (see [§9](#9-cloudflare-vs-portable)):

```sh
pnpm add @forge-cms/cloudflare
```

## 2. Define users + posts

```ts
// server/collections.ts
import { defineCollection, defineField } from '@forge-cms/core';
import { defineUsersCollection } from '@forge-cms/auth';

export const users = defineUsersCollection();

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'author'] },
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({
      required: true,
      unique: true,
      autoGenerate: true,
      sourceField: 'title'
    }),
    body: defineField.richtext(),
    author: defineField.relation({ collection: 'users', required: true })
  },
  access: {
    read: () => true,
    create: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    update: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    delete: ({ user }) => user?.role === 'admin'
  }
});

export const collections = [users, posts];
```

`defineUsersCollection()` is the recommended `users` shape: email, name, a `role` select
(`admin | editor | viewer`, defaulting to `viewer`), and `passwordHash` wired in already. You are
not required to use it — `withAuthFields()` merges the same auth-adapter fields onto a collection
you write by hand — but it is the fastest path and what this guide uses throughout.

## 3. Choose adapters and create the runtime

```ts
// server/runtime.ts
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { D1DatabaseAdapter, type D1Database } from '@forge-cms/cloudflare';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { collections } from './collections';

export interface ServerEnv {
  DB?: D1Database;
  AUTH_SECRET?: string;
}

let runtimePromise: Promise<ForgeCmsRuntime<ServerEnv>> | undefined;

export function getServerRuntime(env?: ServerEnv): Promise<ForgeCmsRuntime<ServerEnv>> {
  runtimePromise ??= buildRuntime(env);
  return runtimePromise;
}

async function buildRuntime(env?: ServerEnv): Promise<ForgeCmsRuntime<ServerEnv>> {
  const database = env?.DB ? new D1DatabaseAdapter() : new InMemoryDatabaseAdapter();
  const auth = new UsersCollectionAuthAdapter({ devMode: !env?.AUTH_SECRET }).init({
    ...env,
    userDatabase: database
  });

  const runtime = new ForgeCmsRuntime<ServerEnv>({
    collections,
    adapters: { database, auth, storage: new InMemoryStorageAdapter() },
    ...(env !== undefined && { env })
  });

  runtime.init();
  await runtime.syncSchema();
  return runtime;
}
```

Build this lazily, on first request, not at module load — a Cloudflare Worker forbids async I/O at
module scope, and this shape works identically outside Cloudflare too. `env?.DB` picks the adapter:
D1 when the binding exists, in-memory otherwise, so the same code runs in local dev and in
production. Swap `D1DatabaseAdapter` for `LibSqlDatabaseAdapter` (`@forge-cms/db`) for the fully
portable profile — see [§9](#9-cloudflare-vs-portable).

## 4. Mount the server API

Every route is a thin wrapper — the actual logic lives in the handler, not the route file. On
Analog/h3:

```ts
// server/routes/api/auth/login.post.ts
import { defineEventHandler, toWebRequest } from 'h3';
import { handleLogin } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  return handleLogin(
    { request: toWebRequest(event), env: event.context.cloudflare?.env },
    { runtime, cookie: { secure: !!event.context.cloudflare?.env } }
  );
});
```

Repeat the same four-line pattern for `signup.post.ts` (`handleSignup`, gate it behind your own
`enabled` flag — off by default), `logout.post.ts` (`handleLogout`), and `me.get.ts` (`handleMe`).
Then the generic collection CRUD routes, same shape, one file per verb:
`GET`/`POST /api/v1/[collection]` (`handleList`/`handleCreate`) and
`GET`/`PUT`/`DELETE /api/v1/[collection]/[id]` (`handleRead`/`handleUpdate`/`handleDelete`). See
[REST API](/docs/rest-api) for the full contract these produce.

## 5. Mount the admin

```ts
// app/admin.routes.ts
import type { Routes } from '@angular/router';
import {
  ForgeAdminLayoutComponent,
  ForgeUsersWorkspaceComponent,
  forgeAdminAuthRoutes,
  forgeAdminContentRoutes
} from '@forge-cms/admin';
import { forgeAuthGuard } from '@forge-cms/angular';

export const ADMIN_ROUTES: Routes = [
  ...forgeAdminAuthRoutes({ signup: true }),
  {
    path: '',
    component: ForgeAdminLayoutComponent,
    canActivate: [forgeAuthGuard()],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'collections' },
      ...forgeAdminContentRoutes(),
      {
        path: 'users',
        component: ForgeUsersWorkspaceComponent,
        canActivate: [forgeAuthGuard({ roles: ['admin'] })]
      }
    ]
  }
];
```

That's the whole admin: sign-in/sign-up, a guarded shell, the reusable collections index and
document editor, and a users workspace gated to admins. No host-written CRUD page. In
`app.config.ts`, add `provideForgeCms({ baseUrl: '/api/v1' })` — no `authToken`; the browser session
is the `forge_session` HttpOnly cookie, and `CmsApiService` sends it automatically.

**One thing to watch for**: `@forge-cms/admin` ships partial-Ivy components, which need Angular's
linker at your app's build time or you'll hit a production-only `JIT compiler unavailable` crash. If
you're on Vite (Analog.js), add the plugin ForgeCMS ships for exactly this:

```ts
// vite.config.ts
import { angularLinker } from '@forge-cms/admin/vite';

export default defineConfig({
  plugins: [angularLinker() /* your other plugins, e.g. analog() */]
});
```

## 6. Create the first admin

There is no seed script and no separate bootstrap endpoint to call — the very first user ever
created in a fresh install is always promoted to `admin`, regardless of any role you pass:

```ts
const admin = await auth.createUser({ email: 'you@example.com', password: 'a-real-password' });
// admin.user.role === 'admin', even though no role was requested
```

A route that guards this behind "no user exists yet" is a few lines of your own server code, not a
new Forge capability:

```ts
// server/routes/api/bootstrap-admin.post.ts
export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;

  if ((await auth.listUsers()).length > 0) {
    throw createError({ statusCode: 409, statusMessage: 'Already initialized' });
  }

  const body = await readBody(event);
  const created = await auth.createUser({ email: body.email, password: body.password });
  if (!created.ok) throw createError({ statusCode: 400, statusMessage: created.reason });
  return { data: { user: created.user } };
});
```

Put a small form behind it (or just `curl` it once) and you have a real first-run flow: zero rows,
zero users, one request, a working admin.

## 7. Sign in

Visit `/admin/login`. On success the server sets the `forge_session` cookie and the Angular session
(`ForgeAuthSession`, injected wherever you need `session.user()`/`session.authenticated()`)
reflects it immediately — no page reload required, and the session survives a real reload because
it's a cookie, not `localStorage`.

## 8. Manage content

`/admin/collections` lists every registered collection; `/admin/collections/posts` is a full
workspace — search, sort, status filter, pagination, create/edit/publish/delete — generated from the
`posts` definition in [§2](#2-define-users--posts). The `author` field renders as a searchable
picker against `users`, not a text box for pasting an id. Nothing here is host code.

## 9. Cloudflare vs. portable

Both profiles run the identical domain from [§2](#2-define-users--posts) — only the database
adapter changes.

**Cloudflare** (the best-supported path):

```ts
import { D1DatabaseAdapter } from '@forge-cms/cloudflare';
const database = new D1DatabaseAdapter(); // .init(env) happens inside runtime.init()
```

Config: a D1 binding (`DB` in `wrangler.toml`), optionally an R2 binding (`BUCKET`) if you add
media, and `AUTH_SECRET` in production (development falls back to a built-in dev secret via
`devMode: true`). See [Deployment](/docs/deployment).

**Portable** (no Cloudflare account, no binding of any kind):

```ts
import { LibSqlDatabaseAdapter } from '@forge-cms/db';
const database = new LibSqlDatabaseAdapter('file:./data.db').init(); // or a real libSQL/Turso URL
```

Same `UsersCollectionAuthAdapter`, same `collections`, same runtime, same admin. Schema sync,
first-admin bootstrap, sign-in, users, post CRUD, drafts, and the relation all work unchanged — this
is proven, not assumed, by `apps/tiny-project`'s own portable-profile integration test in this
repository.

**Not yet portable**: file uploads. `@forge-cms/storage`'s only durable adapter today is
`R2StorageAdapter` (`@forge-cms/cloudflare`) — `InMemoryStorageAdapter` is development/testing only.
A small project on the portable profile that needs persistent uploads currently has no first-class
non-Cloudflare option; an S3-compatible adapter is a reasonable next step but does not exist yet.
Text/content, users, auth, relations, and drafts need no Cloudflare binding at all.

## Next

- [Quickstart](/docs/quickstart) — the bare Local API, no auth or admin.
- [Browser auth](/docs/browser-auth) — the cookie session, CSRF, and signup contract this guide
  builds on.
- [Admin UI](/docs/admin-ui) — every component `@forge-cms/admin` exports.
- [Deployment](/docs/deployment) — the Cloudflare path in full.
