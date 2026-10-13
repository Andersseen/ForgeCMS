---
title: Server quickstart
description: A server-only ForgeCMS project in minutes — schema, runtime, first admin, Local API and HTTP handlers. No Angular, no admin.
group: Getting started
order: 2.1
---

This path is for a TypeScript/Node developer who wants a CMS **without Angular or the admin**. You will install six packages, define two collections, create a runtime on a
local libSQL file, create the first admin, read and write through the Local API with access control enforced, and expose the same data through the framework-agnostic HTTP handlers.

Every file below is the real source of an example that CI installs from the packed `@forge-cms/*` tarballs into an empty project, compiles under strict TypeScript and runs
(`pnpm docs:verify:consumers`). If you want the Angular admin instead, follow the [Angular/Analog quickstart](/docs/angular-quickstart).

## 1. Requirements and install

Node >= 22, pnpm 10, TypeScript 5.9 with ESM output. Start from an empty directory:

```sh
mkdir my-cms && cd my-cms
pnpm init
pnpm pkg set type=module
pnpm add @forge-cms/core @forge-cms/db @forge-cms/auth @forge-cms/storage @forge-cms/api @forge-cms/runtime
pnpm add -D typescript @types/node
```

That is the complete dependency list. None of Angular, `@forge-cms/angular`, `@forge-cms/admin`, VoltUI or the CDK is installed — the server packages do not depend on them.

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

Relative imports in your own `.ts` files use the `.js` extension (`./collections.js`) under `NodeNext`.

## 2. Define collections

`defineUsersCollection()` is the collection the auth adapter manages (email, name, role, password hash). `notes` has a relation to it and **access rules**: anyone may read; only admins and
editors write; only admins delete.

<!-- snippet: docs/examples/server-quickstart/src/collections.ts -->

```ts
import { defineUsersCollection } from '@forge-cms/auth';
import { defineCollection, defineField } from '@forge-cms/core';

// The users collection owned by the auth adapter: email, name, role, password hash.
export const users = defineUsersCollection();

export const notes = defineCollection({
  slug: 'notes',
  fields: {
    title: defineField.text({ required: true }),
    body: defineField.textarea(),
    author: defineField.relation({ collection: 'users', required: true })
  },
  access: {
    read: () => true,
    create: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    update: ({ user }) => user?.role === 'admin' || user?.role === 'editor',
    delete: ({ user }) => user?.role === 'admin'
  }
});

export const collections = [users, notes];
```

## 3. Create the runtime

<!-- snippet: docs/examples/server-quickstart/src/runtime.ts -->

```ts
import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { LibSqlDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';
import { collections } from './collections.js';

export interface ServerEnv {
  /** At least 32 bytes of randomness; signs the session tokens. */
  AUTH_SECRET?: string;
  /** A libSQL URL, for example `file:./forge.db`. */
  DATABASE_URL?: string;
}

export async function createRuntime(env: ServerEnv) {
  const database = new LibSqlDatabaseAdapter(env.DATABASE_URL ?? 'file:./forge.db');
  const auth = new UsersCollectionAuthAdapter().init({
    ...(env.AUTH_SECRET !== undefined && { AUTH_SECRET: env.AUTH_SECRET }),
    userDatabase: database
  });

  const runtime = new ForgeCmsRuntime<ServerEnv>({
    collections,
    adapters: { database, auth, storage: new InMemoryStorageAdapter() },
    env
  });

  runtime.init();
  // Creates missing tables and adds new optional columns. Anything riskier throws SchemaDriftError.
  await runtime.syncSchema();

  return { runtime, auth };
}
```

- `LibSqlDatabaseAdapter` stores everything in a local SQLite-compatible file. `InMemoryStorageAdapter` is for development only; real file storage is [R2 or S3](/docs/deployment).
- `AUTH_SECRET` signs session tokens. It must be at least 32 bytes of randomness in every real deployment; the built-in public dev secret needs an explicit `devMode: true`.
- `syncSchema()` creates the tables on the first run and applies safe additive changes later. A change that would drop, rename or retype data throws `SchemaDriftError` instead of guessing — see
  [Schema upgrades](/docs/schema-upgrades).

## 4. HTTP handlers (optional)

The Local API is the primary interface. When something outside your process needs REST, mount the handlers. They take a standard `Request` and return a standard `Response`, so the same code runs
in Nitro/h3, Hono, a Worker or a plain `node:http` adapter.

<!-- snippet: docs/examples/server-quickstart/src/handlers.ts -->

```ts
import type { ApiContext } from '@forge-cms/api';
import { handleCreate, handleList, type ForgeCmsRuntime } from '@forge-cms/runtime';
import type { ServerEnv } from './runtime.js';

// The HTTP handlers take a Web `Request` and return a Web `Response`, so they mount into any
// framework (Nitro/h3, Hono, Express through a Request adapter, a Cloudflare Worker).
export function notesApi(runtime: ForgeCmsRuntime<ServerEnv>, env: ServerEnv) {
  const context = (request: Request): ApiContext => ({
    request,
    params: { collection: 'notes' },
    env
  });
  return {
    list: (request: Request) => handleList(context(request), { runtime }),
    create: (request: Request) =>
      handleCreate(context(request), { runtime, allowedRoles: ['admin', 'editor'] })
  };
}
```

The HTTP layer always enforces access (it never trusts a caller-supplied override) and answers in the stable envelope: list `{ data, meta }`, item `{ data }`, error `{ error, details? }`.
The full set of handlers (auth, files, versions, globals) is in the [REST API](/docs/rest-api) guide and the [reference](https://github.com/Andersseen/ForgeCMS/blob/main/docs/REFERENCE.md#forge-cmsruntime).

## 5. Run it: first admin, Local API, access

<!-- snippet: docs/examples/server-quickstart/src/main.ts -->

```ts
import { randomBytes } from 'node:crypto';
import { notesApi } from './handlers.js';
import { createRuntime } from './runtime.js';

const env = {
  AUTH_SECRET: process.env['AUTH_SECRET'] ?? randomBytes(32).toString('base64'),
  DATABASE_URL: process.env['DATABASE_URL'] ?? 'file:./forge.db'
};
const { runtime, auth } = await createRuntime(env);

// First admin: the very first user ever created is always an admin.
const existing = await auth.listUsers();
const first =
  existing.length === 0
    ? await auth.createUser({ email: 'admin@example.com', password: 'a-long-passphrase' })
    : undefined;
if (first && !first.ok) throw new Error(`could not create the first admin: ${first.reason}`);

const login = await auth.login('admin@example.com', 'a-long-passphrase');
if (!login.ok) throw new Error('sign-in failed (is this database from an earlier run?)');
const admin = login.user;

// Local API with the admin's access rules enforced (`overrideAccess: false`).
const note = await runtime.create({
  collection: 'notes',
  data: { title: 'Hello ForgeCMS', body: 'First note', author: admin.id },
  user: admin,
  overrideAccess: false
});

const found = await runtime.find({
  collection: 'notes',
  where: { title: 'Hello ForgeCMS' }
});
console.log('Local API:', found.docs.length, 'note(s), first id', String(note.id));

// The same data over the framework-agnostic HTTP handlers.
const response = await notesApi(runtime, env).list(new Request('http://localhost/api/v1/notes'));
const body = (await response.json()) as { data: unknown[]; meta: { totalDocs: number } };
console.log('HTTP handler:', response.status, body.meta.totalDocs, 'note(s)');

// Anonymous callers can read, but may not write.
try {
  await runtime.create({
    collection: 'notes',
    data: { title: 'Nope', author: admin.id },
    user: null,
    overrideAccess: false
  });
  throw new Error('anonymous create was allowed');
} catch (error) {
  console.log('Anonymous create refused:', (error as Error).name);
}
```

```sh
pnpm exec tsc
AUTH_SECRET="$(openssl rand -base64 32)" node dist/main.js
```

You should see the note counted through the Local API and through the HTTP handler, and the anonymous write refused:

```txt
Local API: 1 note(s), first id …
HTTP handler: 200 1 note(s)
Anonymous create refused: AccessDeniedError
```

What happened, and the rules behind it:

- **First admin.** The very first user ever created in a fresh installation is always an `admin`, whatever role is requested; later users default to `viewer`. A real app guards a bootstrap route behind
  "no user exists yet" (the Angular quickstart shows it).
- **Local API access.** Server code is trusted: `overrideAccess` defaults to `true`. Passing `overrideAccess: false` with a `user` runs the same access rules the HTTP layer uses, which is why the anonymous
  create fails and the admin's succeeds.
- **Secrets.** `AUTH_SECRET` here is regenerated for the demo; a long-running server must keep one stable value or every session is invalidated on restart.

## Where next

- Make it durable and deploy: [Deployment](/docs/deployment) — Cloudflare (D1 + R2) or Node (libSQL + S3). A production build must not use the in-memory adapters.
- Add users, drafts, uploads and a login route: [Small project guide](/docs/small-project-guide), [Browser auth](/docs/browser-auth), [Uploads](/docs/uploads).
- Add the Angular client and admin: [Angular/Analog quickstart](/docs/angular-quickstart).
- Something failing? [Troubleshooting](/docs/troubleshooting).
