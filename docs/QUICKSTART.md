# QUICKSTART — build your first ForgeCMS

ForgeCMS `0.0.1` is the first public experimental release. This guide is for using ForgeCMS from a
separate application repository, not for contributing to this monorepo.

## Prerequisites

- Node >= 22
- pnpm 10
- TypeScript with ESM output

## 1. Install the runtime packages

```sh
pnpm add @forge-cms/core @forge-cms/runtime @forge-cms/db @forge-cms/auth @forge-cms/storage
```

Add Cloudflare adapters only when deploying to Workers/Pages with D1 or R2:

```sh
pnpm add @forge-cms/cloudflare
```

## 2. Define one collection

Create `src/cms.ts`:

```ts
import { defineCollection, defineField } from '@forge-cms/core';

export const notes = defineCollection({
  slug: 'notes',
  fields: {
    title: defineField.text({ required: true }),
    data: defineField.json()
  }
});
```

## 3. Create and initialize a runtime

```ts
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { notes } from './cms.js';

export const runtime = new ForgeCmsRuntime({
  collections: [notes],
  adapters: {
    database: new InMemoryDatabaseAdapter(),
    auth: new InMemoryAuthAdapter(),
    storage: new InMemoryStorageAdapter()
  }
});

runtime.init();
await runtime.syncSchema();
```

That is the supported bootstrap pattern for `0.0.1`: choose adapters, create `ForgeCmsRuntime`, call
`init()`, then call `syncSchema()`.

## 4. Use the Local API

```ts
const created = await runtime.create({
  collection: 'notes',
  data: {
    title: 'Hello ForgeCMS',
    data: { mood: 'curious' }
  }
});

const page = await runtime.find({
  collection: 'notes',
  limit: 10
});

await runtime.update({
  collection: 'notes',
  id: String(created.id),
  data: { title: 'Updated title' }
});

await runtime.delete({
  collection: 'notes',
  id: String(created.id)
});
```

Direct Local API calls are trusted server-side calls. They skip access checks by default. Pass
`overrideAccess: false` and a `user` when you want to run an operation under normal CMS access rules,
which is what the HTTP handlers do for network requests.

## 5. Expose HTTP handlers

ForgeCMS runtime handlers are framework-agnostic: they take an `ApiContext` and return a standard
`Response`.

```ts
import type { ApiContext } from '@forge-cms/api';
import { handleCreate, handleList } from '@forge-cms/runtime';
import { runtime } from './runtime.js';

export function listNotes(context: ApiContext) {
  return handleList(
    {
      ...context,
      params: { collection: 'notes' }
    },
    { runtime }
  );
}

export function createNote(context: ApiContext) {
  return handleCreate(
    {
      ...context,
      params: { collection: 'notes' }
    },
    { runtime }
  );
}
```

Your framework adapter only needs to build `{ request, params, env }`. Analog/Nitro, Hono, Express
via Web `Request`, and Cloudflare Workers can all call the same handlers.

## Schema synchronization

`runtime.syncSchema()` asks the configured database adapter to create or update the storage shape for
registered collections and globals.

For the built-in SQLite-style adapters, it is intentionally additive:

- It creates missing tables.
- It adds missing columns.
- It creates configured indexes where supported.
- It does not drop columns.
- It does not rename columns.
- It does not change column types.
- It does not migrate or backfill existing data.

This makes `syncSchema()` convenient during development and acceptable on startup for small early
deployments, including D1-backed deployments, but it is not a complete migration system. Destructive
schema changes still need a deliberate migration plan.

## Angular and admin packages

For Angular apps:

```sh
pnpm add @forge-cms/angular
```

```ts
import { provideForgeCms } from '@forge-cms/angular';

export const appConfig = {
  providers: [provideForgeCms({ baseUrl: '/api' })]
};
```

For the admin components:

```sh
pnpm add @forge-cms/admin @forge-cms/angular @angular/common @angular/core @angular/forms @angular/router rxjs @voltui/components lumen-icons
```

`@forge-cms/admin` is a component library, not a full hosted admin application. Bring its exported
standalone components into your Angular routes and provide your own routing shell around them.

## Developing ForgeCMS itself

To work on this repository:

```sh
git clone https://github.com/Andersseen/ForgeCMS.git
cd ForgeCMS
pnpm install
pnpm build
pnpm dev:www
```

Contributor workflow and quality gates live in [../CLAUDE.md](../CLAUDE.md) and
[CONTRIBUTING.md](../CONTRIBUTING.md).
