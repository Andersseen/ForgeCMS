---
title: Angular/Analog quickstart
description: An Analog.js app with the ForgeCMS server routes, the typed Angular client and the reusable admin — install, linker, routes, first admin and login.
group: Getting started
order: 2.2
---

This path builds an **Analog.js** application that serves the ForgeCMS API from Nitro routes and mounts the **reusable admin** at `/admin`. It uses only public `@forge-cms/*` packages. Every file
below is the real source of an example that CI installs from the packed tarballs into an empty project, type-checks with strict TypeScript and strict Angular templates, builds for production,
and then drives the built server and a real browser (`pnpm docs:verify:consumers`).

It uses development adapters (in-memory database and storage), so data resets when the server restarts. Durable profiles are the [Deployment](/docs/deployment) guide. Server-only? Use the
[Server quickstart](/docs/server-quickstart).

## 1. Create the app and install

Create an Analog app with its own tooling (`npm create analog@latest`, then switch to pnpm if you prefer) or start from an empty Vite + Analog project, then add Forge. The tested combination is Angular
21.2, Analog 2.5, Vite 7, TypeScript 5.9 ([support matrix](https://github.com/Andersseen/ForgeCMS/blob/main/docs/SUPPORT.md)).

```sh
# ForgeCMS server packages
pnpm add @forge-cms/core @forge-cms/db @forge-cms/auth @forge-cms/storage @forge-cms/api @forge-cms/runtime h3
# Angular client and admin
pnpm add @forge-cms/angular @forge-cms/admin
# the admin's peers (the Angular packages are normally already in your app)
pnpm add @angular/cdk @voltui/components lumen-icons rxjs
# the linker's tooling and the Node types the server files use
pnpm add -D @angular/compiler-cli @babel/core vite @types/node
```

The admin requires **Angular 21** (`^21.2.0`). `@forge-cms/angular` alone also supports Angular 22 (with `@babel/core` 8).

## 2. Add the official linker

`@forge-cms/angular` and `@forge-cms/admin` ship Angular partial-Ivy code. A Vite/Analog build must link it, or production crashes with `JIT compiler unavailable`. Use the plugin Forge ships — nothing else:

<!-- snippet: docs/examples/analog-quickstart/vite.config.ts -->

```ts
import analog from '@analogjs/platform';
import { defineConfig } from 'vite';
import { angularLinker } from '@forge-cms/admin/vite';

export default defineConfig({
  plugins: [
    // Forge ships partial-Ivy code; the official linker compiles it at build time.
    angularLinker(),
    analog({ ssr: false, nitro: { preset: 'node-server' } })
  ],
  build: { target: 'es2022' }
});
```

`ssr: false` keeps this quickstart a browser app with a Nitro API; the [SSR guide](/docs/ssr) turns on server rendering. Analog's build still requires a server entry file:

<!-- snippet: docs/examples/analog-quickstart/src/main.server.ts -->

```ts
// Analog's build requires a server entry even with `ssr: false`. This app renders in the browser;
// the SSR guide replaces this stub with a real renderer.
export default function bootstrap() {
  return Promise.resolve();
}
```

## 3. Collections and the runtime (server)

Put server code under `src/server`. The collections define users, an upload-enabled `media` collection and `posts` with drafts:

<!-- snippet: docs/examples/analog-quickstart/src/server/collections.ts -->

```ts
import { defineUsersCollection } from '@forge-cms/auth';
import { defineCollection, defineField } from '@forge-cms/core';

export const users = defineUsersCollection();

export const media = defineCollection({
  slug: 'media',
  upload: true,
  fields: {
    filename: defineField.text({ required: true }),
    url: defineField.text(),
    contentType: defineField.text(),
    filesize: defineField.number(),
    alt: defineField.text()
  },
  access: {
    read: () => true,
    create: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    update: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    delete: ({ user }) => user?.role === 'admin'
  }
});

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'author'] },
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({ unique: true, autoGenerate: true, sourceField: 'title' }),
    body: defineField.richtext(),
    cover: defineField.upload({ collection: 'media' }),
    author: defineField.relation({ collection: 'users', required: true })
  },
  access: {
    read: () => true,
    create: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    update: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    delete: ({ user }) => user?.role === 'admin'
  }
});

export const collections = [users, media, posts];
```

<!-- snippet: docs/examples/analog-quickstart/src/server/runtime.ts -->

```ts
import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { collections } from './collections';

export interface ServerEnv {
  /** At least 32 bytes of randomness; signs the session tokens. */
  AUTH_SECRET?: string;
}

let runtimePromise: Promise<ForgeCmsRuntime<ServerEnv>> | undefined;

/** Built on the first request (not at module load) and shared afterwards. */
export function getServerRuntime(): Promise<ForgeCmsRuntime<ServerEnv>> {
  runtimePromise ??= buildRuntime();
  return runtimePromise;
}

async function buildRuntime(): Promise<ForgeCmsRuntime<ServerEnv>> {
  const env: ServerEnv = {};
  const secret = process.env['AUTH_SECRET'];
  if (secret !== undefined) env.AUTH_SECRET = secret;

  // DEVELOPMENT ADAPTERS: everything is lost when the server restarts. A real deployment uses a durable
  // profile (D1 + R2, or libSQL + S3) — see the Deployment guide.
  const database = new InMemoryDatabaseAdapter();
  const auth = new UsersCollectionAuthAdapter().init({ ...env, userDatabase: database });

  const runtime = new ForgeCmsRuntime<ServerEnv>({
    collections,
    adapters: { database, auth, storage: new InMemoryStorageAdapter() },
    env
  });

  runtime.init();
  await runtime.syncSchema();
  return runtime;
}
```

The runtime is built lazily on the first request (Cloudflare Workers forbid async I/O at module scope, and this shape works everywhere). Set `AUTH_SECRET` (at least 32 bytes) in `.env` for development and
in the environment of the built server.

## 4. Mount the API routes

Every route is a thin wrapper over a runtime handler; no logic lives in the route. A small helper builds the framework-agnostic `ApiContext` from an h3 event:

<!-- snippet: docs/examples/analog-quickstart/src/server/context.ts -->

```ts
import { getRouterParam, toWebRequest, type H3Event } from 'h3';
import type { ApiContext } from '@forge-cms/api';

/** The framework-agnostic context every Forge handler takes, built from an h3 event. */
export function apiContext(event: H3Event, ...params: string[]): ApiContext {
  return {
    request: toWebRequest(event),
    // Ids and slugs arrive percent-encoded as one path segment.
    params: Object.fromEntries(
      params.map((name) => [name, decodeURIComponent(getRouterParam(event, name) ?? '')])
    ),
    env: undefined
  };
}

/** Session cookie options: `Secure` in production (serve it over HTTPS), plain for local development. */
export const sessionCookie = { secure: process.env['NODE_ENV'] === 'production' };
```

**Auth** (`/api/auth/*`, the client's default `authBaseUrl`):

<!-- snippet: docs/examples/analog-quickstart/src/server/routes/api/auth/login.post.ts -->

```ts
import { defineEventHandler } from 'h3';
import { handleLogin } from '@forge-cms/runtime';
import { apiContext, sessionCookie } from '../../../context';
import { getServerRuntime } from '../../../runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime();
  return handleLogin(apiContext(event), { runtime, cookie: sessionCookie });
});
```

Create `logout.post.ts` (`handleLogout`, with `cookie: sessionCookie`) and `me.get.ts` (`handleMe`) the same way — their sources are in the verified example
([`logout.post.ts`](https://github.com/Andersseen/ForgeCMS/blob/main/docs/examples/analog-quickstart/src/server/routes/api/auth/logout.post.ts),
[`me.get.ts`](https://github.com/Andersseen/ForgeCMS/blob/main/docs/examples/analog-quickstart/src/server/routes/api/auth/me.get.ts)).

**Content** (`/api/v1/*`, the client's default `baseUrl`): `GET`/`POST /api/v1/[collection]`, `GET`/`PUT`/`DELETE /api/v1/[collection]/[id]`, and `GET /api/v1/collections` for the admin's schema metadata:

<!-- snippet: docs/examples/analog-quickstart/src/server/routes/api/v1/[collection]/[id].put.ts -->

```ts
import { defineEventHandler } from 'h3';
import { handleUpdate } from '@forge-cms/runtime';
import { apiContext } from '../../../../context';
import { getServerRuntime } from '../../../../runtime';

export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime();
  return handleUpdate(apiContext(event, 'collection', 'id'), {
    runtime,
    allowedRoles: ['admin', 'editor']
  });
});
```

The other content routes —
[`[collection].get.ts`](https://github.com/Andersseen/ForgeCMS/blob/main/docs/examples/analog-quickstart/src/server/routes/api/v1/[collection].get.ts) (`handleList`),
[`[collection].post.ts`](https://github.com/Andersseen/ForgeCMS/blob/main/docs/examples/analog-quickstart/src/server/routes/api/v1/[collection].post.ts) (`handleCreate`, which also accepts multipart uploads),
[`[id].get.ts`](https://github.com/Andersseen/ForgeCMS/blob/main/docs/examples/analog-quickstart/src/server/routes/api/v1/[collection]/[id].get.ts) (`handleRead`),
[`[id].delete.ts`](https://github.com/Andersseen/ForgeCMS/blob/main/docs/examples/analog-quickstart/src/server/routes/api/v1/[collection]/[id].delete.ts) (`handleDelete`) and
[`collections.get.ts`](https://github.com/Andersseen/ForgeCMS/blob/main/docs/examples/analog-quickstart/src/server/routes/api/v1/collections.get.ts) — are the same four lines with a different handler.

**Media** — uploaded files are served by `handleFile`, which applies the owning document's access rules, at the storage adapter's default URL `GET /api/media/[...key]`
([`[...key].get.ts`](https://github.com/Andersseen/ForgeCMS/blob/main/docs/examples/analog-quickstart/src/server/routes/api/media/[...key].get.ts)).

**First admin** — the first user ever created is always an admin. This route creates it and signs it in, and refuses once any user exists:

<!-- snippet: docs/examples/analog-quickstart/src/server/routes/api/bootstrap-admin.post.ts -->

```ts
import {
  createError,
  defineEventHandler,
  readBody,
  setResponseHeader,
  setResponseStatus
} from 'h3';
import { buildSessionCookie, type UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { sessionCookie } from '../../context';
import { getServerRuntime } from '../../runtime';

// Creates the FIRST user, who is always an admin, and signs them in. Refuses once any user exists.
export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime();
  const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;

  if ((await auth.listUsers()).length > 0) {
    throw createError({ statusCode: 409, statusMessage: 'Already initialized' });
  }

  const body = (await readBody<{ email?: string; password?: string }>(event)) ?? {};
  if (!body.email || !body.password) {
    throw createError({ statusCode: 400, statusMessage: 'Missing email or password' });
  }

  const created = await auth.createUser({ email: body.email, password: body.password });
  if (!created.ok) throw createError({ statusCode: 400, statusMessage: created.reason });

  const login = await auth.login(body.email, body.password);
  if (login.ok)
    setResponseHeader(event, 'set-cookie', buildSessionCookie(login.token, sessionCookie));

  setResponseStatus(event, 201);
  return { data: { user: created.user } };
});
```

## 5. The Angular side: providers, routes, admin

The admin reads its route data through component inputs, so the router needs `withComponentInputBinding()`. `provideForgeCms()` is the one place that names the APIs — the values below are the defaults.

<!-- snippet: docs/examples/analog-quickstart/src/app/app.config.ts -->

```ts
import type { ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideVoltTheme } from '@voltui/components';
import { provideForgeCms } from '@forge-cms/angular';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    // The admin reads its route data through component inputs: this feature is required.
    provideRouter(routes, withComponentInputBinding()),
    provideVoltTheme({ color: 'volt', style: 'soft' }),
    // The only place that names the APIs. These are the defaults, written out for clarity.
    provideForgeCms({ baseUrl: '/api/v1', authBaseUrl: '/api/auth', credentials: 'include' })
  ]
};
```

<!-- snippet: docs/examples/analog-quickstart/src/app/app.routes.ts -->

```ts
import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./pages/home.page').then((m) => m.HomePage)
  },
  {
    path: 'admin',
    loadChildren: () => import('./admin.routes').then((m) => m.ADMIN_ROUTES)
  },
  { path: '**', redirectTo: '' }
];
```

Mounting the admin is the whole of `admin.routes.ts` — sign-in, a guarded shell and the reusable collections index and document editor:

<!-- snippet: docs/examples/analog-quickstart/src/app/admin.routes.ts -->

```ts
import type { Routes } from '@angular/router';
import {
  ForgeAdminLayoutComponent,
  forgeAdminAuthRoutes,
  forgeAdminContentRoutes
} from '@forge-cms/admin';
import { forgeAuthGuard } from '@forge-cms/angular';

export const ADMIN_ROUTES: Routes = [
  // /admin/login
  ...forgeAdminAuthRoutes(),
  {
    path: '',
    component: ForgeAdminLayoutComponent,
    data: { config: { title: 'My site' } },
    canActivate: [forgeAuthGuard()],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'collections' },
      // /admin/collections, /admin/collections/:collection, …/new, …/:id
      ...forgeAdminContentRoutes()
    ]
  }
];
```

`forgeAuthGuard()` sends an anonymous visitor to `/admin/login?returnUrl=…` and only honours a `returnUrl` under the mount root. It is UX; the server decides. To mount somewhere else, or add the Users
workspace and sign-up, see [Admin UI](/docs/admin-ui#mounting-somewhere-other-than-admin) and the [small project guide](/docs/small-project-guide). The remaining files (`index.html`, `main.ts`,
`app.component.ts`, a home page that lists published posts with `collectionResource`) are in the
[example directory](https://github.com/Andersseen/ForgeCMS/tree/main/docs/examples/analog-quickstart).

```json
// tsconfig.json (excerpt) — strict, with Angular's strict templates
{
  "compilerOptions": {
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "types": ["node"]
  },
  "angularCompilerOptions": { "strictTemplates": true, "strictInjectionParameters": true }
}
```

## 6. Run it and log in

```sh
echo "AUTH_SECRET=$(openssl rand -base64 32)" > .env
pnpm exec vite dev
```

Create the first admin once (the route refuses a second call with `409`):

```sh
curl -X POST http://localhost:5173/api/bootstrap-admin \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"a-long-passphrase"}'
```

Open `/admin`: you are redirected to `/admin/login`; sign in and you land on `/admin/collections`, where the `posts` workspace lets you create, edit, publish and delete — generated from the definition above.
Anonymous visitors to `/` see only published posts.

For a production build, run `pnpm exec vite build`, then start the server with `AUTH_SECRET=… NODE_ENV=production node dist/analog/server/index.mjs`. `NODE_ENV=production` makes the session cookie
`Secure`, so serve it over HTTPS.

## Where next

- A durable database and file storage, and deployment to Cloudflare or Node: [Deployment](/docs/deployment).
- Users workspace, sign-up, drafts and the long walkthrough: [Small project guide](/docs/small-project-guide).
- Server rendering and public hydration: [Server rendering](/docs/ssr). The typed client: [Angular client](/docs/angular-client).
- Something failing — `JIT compiler unavailable`, `401` vs `403`, CSRF? [Troubleshooting](/docs/troubleshooting).
