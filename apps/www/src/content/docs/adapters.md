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
  updateIf(
    collection: string,
    id: string,
    data: Partial<TRecord>,
    condition: WriteCondition
  ): Promise<ConditionalUpdateResult<TRecord>>;
  deleteIf(
    collection: string,
    id: string,
    condition: WriteCondition
  ): Promise<ConditionalDeleteResult>;
  atomicWrite(
    operations: readonly AtomicWriteOperation<TRecord>[]
  ): Promise<AtomicWriteResult<TRecord>[]>;
  syncSchema(collections: CollectionDefinition[]): Promise<void>;
}
```

`updateIf`/`deleteIf` are **conditional writes**: the condition and the write are one atomic step, decided
by the database rather than by a read your code did earlier. A `WriteCondition` has two optional clauses —
`targetMatches` (the row must currently match; per-row compare-and-set) and
`keepAtLeast: { where, others }` (the row may leave the set matching `where` only while at least `others`
_other_ rows of the collection stay in it — this is what keeps a users collection from losing its last
admin). A missing row or an unmet condition returns `{ applied: false }`; it is not an error. A database
failure rejects — it is never reported as "not applied". `LibSqlDatabaseAdapter` and `D1DatabaseAdapter`
run each as one guarded SQL statement, so it holds across independent Workers or processes;
`InMemoryDatabaseAdapter` is atomic within one adapter instance only. This is a single-row primitive, not a
transaction. Writing your own adapter? Implement both methods and run
`runDatabaseAdapterConditionalWriteContractTests` alongside the other suites; `UsersCollectionAuthAdapter`
refuses to initialise over a database that lacks them.

`atomicWrite` is an **atomic write batch**: an ordered list of `create`/`update`/`delete`/`updateIf`/
`deleteIf` operations (the same names and semantics as the methods above) that **all commit or none do**.
It is declarative data — there is no callback, so no hook, HTTP call or other async work can run between
statements — and it is database-only: a database and an object store (D1 + R2, libSQL + S3) can never
commit together, so an upload lifecycle needs compensation, not a batch.

```ts
const [claim, user] = await database.atomicWrite([
  { type: 'create', collection: '_forge_bootstrap', data: { slot: 'users' } },
  { type: 'create', collection: 'users', data: { email, role: 'admin', passwordHash } }
]);
```

- Operations run in order; later ones see what earlier ones wrote. Results come back in the same order
  and length, discriminated by `type` (`create`/`update` → `{ record }`; `updateIf` → `{ applied, record? }`;
  `deleteIf` → `{ applied }`; `delete` → `{}`). An empty batch returns `[]`.
- Failure rolls everything back and rejects: a unique-index violation → `UniqueConstraintError` (its
  `collection` says which table conflicted); a plain `update` of a missing row, or an `updateIf`/`deleteIf`
  with `requireApplied: true` that does not apply → `AtomicWriteConditionError`. Without `requireApplied`
  a conditional operation may report `applied: false` and the rest of the batch still commits — use
  `requireApplied` whenever a later operation depends on it (e.g. a document compare-and-set followed by
  its snapshot insert). `delete` of a missing row is a no-op.
- Invalid input — more than `ATOMIC_WRITE_MAX_OPERATIONS` (25) operations, a malformed operation, and on
  the SQL adapters an unknown column or unregistered collection — rejects **before anything is written**.
- Retry: `UniqueConstraintError` and `AtomicWriteConditionError` mean "known rolled back". A network
  failure after the request left the process is outcome-unknown; supply your own unique keys (on the SQL adapters, ids too) so a retry
  is recognisable, and do not assume exactly-once.
- `LibSqlDatabaseAdapter` runs one `client.batch(statements, 'write')`; `D1DatabaseAdapter` runs one D1
  `batch()`; `InMemoryDatabaseAdapter` stages a copy of the touched collections and publishes it in one
  synchronous turn (atomic within one adapter instance only). Writing your own adapter? It must be
  genuinely atomic — a loop of independent writes is not an implementation. If you are SQLite-based, reuse
  the exported `assertValidAtomicWrite`, `toAtomicWriteError`, `atomicWriteMustApply` (which operations
  must be followed by the guard statement) and `ATOMIC_WRITE_REQUIRE_APPLIED_SQL`, and run
  `runDatabaseAdapterAtomicWriteContractTests`. `UsersCollectionAuthAdapter` refuses to initialise over a
  database that lacks `atomicWrite`, because first-admin provisioning depends on it.

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
  // optional, all additive: syncSchema?(), canHandleToken?(token), login?(…), signup?(…), and
  managesCollection?(slug: string): boolean;
}
```

`requireAuth` throws `ForgeAuthError` with code `unauthorized`, `forbidden` or `expired`.

**`managesCollection?(slug)`** declares that the adapter owns the identity and lifecycle of a Forge
collection's documents. When it returns `true`, the runtime refuses generic `create`/`update`/`delete`
of that collection with `AuthManagedCollectionError` (`403`, `AUTH_MANAGED_COLLECTION`) — Local API with
`overrideAccess` `true` or `false`, and HTTP — because those writes would bypass the adapter's own
invariants. Reads and every other collection are unaffected. Omit it (absent means `false`) unless your
adapter stores users in a Forge collection and enforces rules on them; `UsersCollectionAuthAdapter`
answers `true` for exactly its configured `collection`, and `CompositeAuthAdapter` for whatever any child
claims.

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
