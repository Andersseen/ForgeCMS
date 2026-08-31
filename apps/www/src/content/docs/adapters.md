---
title: Adapters
description: The three contracts, the implementations that ship, and how to write your own.
group: Client & deploy
order: 3
---

Adapters are the only layer that touches the outside world. Everything above them — operations,
hooks, access, validation — is the same whether you are on SQLite in a file, D1 at the edge, or a
`Map` in a test.

## What ships

| Contract          | Implementation               | Package                 | Notes                                   |
| ----------------- | ---------------------------- | ----------------------- | --------------------------------------- |
| `DatabaseAdapter` | `InMemoryDatabaseAdapter`    | `@forge-cms/db`         | Local dev and tests; resets on reload   |
| `DatabaseAdapter` | `LibSqlDatabaseAdapter`      | `@forge-cms/db`         | SQLite / Turso, via drizzle             |
| `DatabaseAdapter` | `D1DatabaseAdapter`          | `@forge-cms/cloudflare` | Cloudflare D1, with index creation      |
| `AuthAdapter`     | `UsersCollectionAuthAdapter` | `@forge-cms/auth`       | Real users in your database, PBKDF2     |
| `AuthAdapter`     | `SignedTokenAuthAdapter`     | `@forge-cms/auth`       | Signed tokens, no user store            |
| `AuthAdapter`     | `ExternalAuthAdapter`        | `@forge-cms/auth`       | Delegates validation to another service |
| `AuthAdapter`     | `InMemoryAuthAdapter`        | `@forge-cms/auth`       | Tests                                   |
| `StorageAdapter`  | `InMemoryStorageAdapter`     | `@forge-cms/storage`    | Local dev and tests                     |
| `StorageAdapter`  | `R2StorageAdapter`           | `@forge-cms/cloudflare` | Cloudflare R2                           |

There is no KV adapter, despite what older notes may suggest.

## `DatabaseAdapter`

```ts
interface DatabaseAdapter<TRecord extends DatabaseRecord = DatabaseRecord> {
  readonly name: string;
  init(env?: unknown): this;
  findById(collection: string, id: string): Promise<TRecord | null>;
  findMany(options: FindManyOptions): Promise<TRecord[]>;
  count(collection: string, where?: DatabaseWhere): Promise<number>;
  create(collection: string, data: TRecord): Promise<TRecord>;
  update(collection: string, id: string, data: Partial<TRecord>): Promise<TRecord>;
  delete(collection: string, id: string): Promise<void>;
  syncSchema(collections: CollectionDefinition[]): Promise<void>;
}
```

`FindManyOptions` is `{ collection, limit?, offset?, where?, sort?, order? }`. `count` must honour
the same `where` as `findMany` — otherwise pagination advertises pages that do not exist. The SQL
adapters share one where-clause builder between the two so they cannot drift.

`DatabaseWhere` supports nested `and`/`or` groups on top of the flat field operators, and `sort`
accepts a single field name or a `{ field, order }[]` for a multi-field sort — see
[Local API](/docs/local-api#find). `InMemoryDatabaseAdapter` evaluates them with a pure recursive
`matchesWhere`, the executable reference every adapter's generated SQL is proven against by a shared
cross-adapter contract suite (`runDatabaseAdapterQueryContractTests`,
`@forge-cms/testing/contracts`). Writing your own `DatabaseAdapter`? Run that suite too, alongside
`runDatabaseAdapterContractTests`.

## `AuthAdapter`

```ts
interface AuthAdapter<TUser extends AuthUser = AuthUser> {
  readonly name: string;
  init(env?: unknown): this;
  extractToken(request: Request): string | null;
  validateSession(token: string): Promise<AuthSession<TUser> | null>;
  requireAuth(request: Request): Promise<TUser>;
}
```

`requireAuth` throws `ForgeAuthError` with code `unauthorized`, `forbidden` or `expired`.

### `UsersCollectionAuthAdapter`

```ts
const database = env?.DB ? new D1DatabaseAdapter() : new InMemoryDatabaseAdapter();
const auth = new UsersCollectionAuthAdapter().init({ ...env, userDatabase: database });
```

Users live in a normal collection (`users` by default) with PBKDF2-hashed passwords and an
admin/editor/viewer role. `AUTH_SECRET` from the env signs the tokens.

**Wrap the collection with `withAuthFields()`** so schema generation covers the columns the adapter
writes:

```ts
import { withAuthFields } from '@forge-cms/auth';

const collections = [posts, media, withAuthFields(users)];
```

Skipping it produces `table users has no column named passwordHash` the first time someone logs in
against a real database.

## `StorageAdapter`

```ts
interface StorageAdapter {
  readonly name: string;
  init(env?: unknown): this;
  put(options: PutObjectOptions): Promise<StorageObject>;
  get(key: string): Promise<StorageObject | null>;
  delete(key: string): Promise<void>;
  getPublicUrl(key: string): Promise<string>;
  list(prefix?: string): Promise<StorageObject[]>;
}
```

`getPublicUrl` must return something a browser can actually load. `R2StorageAdapter` defaults to the
path `handleFile` is meant to be mounted on; point it at a custom domain when the bucket is public:

```ts
new R2StorageAdapter({ binding: 'BUCKET', publicUrlBase: 'https://cdn.example.com' });
```

## Selecting adapters at runtime

Bindings only exist on the deployed Worker, so pick per request:

```ts
export async function getServerRuntime(env?: ServerEnv) {
  const database = env?.DB ? new D1DatabaseAdapter() : new InMemoryDatabaseAdapter();
  const storage = env?.BUCKET ? new R2StorageAdapter() : new InMemoryStorageAdapter();
  const auth = new UsersCollectionAuthAdapter().init({ ...env, userDatabase: database });

  const runtime = new ForgeCmsRuntime({ collections, adapters: { database, auth, storage }, env });
  runtime.init();
  await runtime.syncSchema();
  return runtime;
}
```

Both D1 and R2 adapters take a `binding` option, so a Worker with two databases can use both:

```ts
new D1DatabaseAdapter({ binding: 'CONTENT_DB' });
```

Build the runtime **lazily on first request**, not at module scope — Cloudflare Workers forbid async
I/O at module load, and seeding at import time breaks the deploy.

## Writing your own

Any new adapter must pass the shared contract suites:

```ts
import { describe } from 'vitest';
import { runDatabaseAdapterContractTests } from '@forge-cms/testing/contracts';
import { PostgresDatabaseAdapter } from './postgres.adapter.js';

describe('PostgresDatabaseAdapter', () => {
  runDatabaseAdapterContractTests(() => new PostgresDatabaseAdapter(/* … */).init());
});
```

There are equivalent suites for auth and storage. `@forge-cms/testing/contracts` is the one official
deep import in the whole workspace.

Two behaviours the suites pin down because they were real bugs: `contains` is **case-insensitive**
(SQLite's `LIKE` semantics — the in-memory adapter had to be taught to match), and adapters stamp
`created_at`/`updated_at` themselves.
