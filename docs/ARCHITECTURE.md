# ARCHITECTURE — Package graph, data flow, contracts

## Package dependency graph

Arrows point from dependent to dependency. Everything ultimately rests on `core`.

```
                                  ┌────────────┐
                                  │    core    │  schema DSL + validation
                                  └────────────┘
                                    ▲  ▲  ▲  ▲
                 ┌──────────────────┘  │  │  └──────────────────┐
           ┌─────┴────┐         ┌──────┴───┐  ┌────┴─────┐  ┌───┴────┐
           │    db    │         │   auth   │  │ storage  │  │  api   │  (contracts/types)
           └──────────┘         └──────────┘  └──────────┘  └────────┘
              ▲     ▲                 ▲             ▲            ▲
              │     └───────┐         └──────┬──────┘            │
        ┌─────┴──────┐   ┌──┴──────────────────────────┐         │
        │ cloudflare │   │           runtime           │─────────┘
        └────────────┘   └─────────────────────────────┘
         D1, R2 adapters    orchestrator + HTTP handlers
                                        ▲
                                        │ (server side)
   ┌─────────┐   ┌─────────┐   ┌───────┴────────┐   ┌────────────┐
   │ angular │◄──│  admin  │   │  apps/www      │   │ playground │
   └─────────┘   └─────────┘   │  h3 API routes │   └────────────┘
    client SDK    admin UI     └────────────────┘
    (browser side, talks to the API over HTTP)

   testing ──► used by all packages in *.test.ts (contract suites)
```

Rules encoded in this graph:

- `core` imports nothing from the workspace.
- Contract packages (`db`, `auth`, `storage`, `api`) import only `core`.
- Adapter implementations live either next to their contract (in-memory, libsql) or in a
  platform package (`cloudflare`). `cloudflare` reuses `db`'s schema-generator helpers.
- `runtime` is the only package that knows about all three adapter contracts at once.
- Apps consume packages; packages never import from apps.
- **No import cycles** — enforced by ESLint (`import/no-cycle`).

### ForgeCMS and Strata (current state, spec 071)

- **No `packages/*` manifest depends on Strata**, and none may without a spec.
- `apps/tiny-project` installs the published `@strata-sc/core`/`@strata-sc/analog` (0.1.0) as an
  external consumer. Its `CollectionsController` serves `GET /api/v1/:collection` and
  `GET /api/v1/:collection/:id` by delegating to `handleList`/`handleRead`.
- **Strata owns server transport and lifecycle; Forge owns CMS behaviour** (access, drafts, queries,
  envelopes). The controller adapts the request and nothing else.
- Only bodyless reads move. `StrataAnalogRequest` exposes no Web `Request` (no body, no
  `AbortSignal`, synthetic origin), so mutations, auth and uploads stay on H3. The app-local
  `createForgeReadContext` throws for any method other than GET/HEAD.
- **Strata Server Components are not consumed.** `@strata-sc/server-components` is private and
  unpublished, and it targets Angular 22 / Analog 2.7 / Vite 8. The candidate first slice, once it is
  published with a compatible peer range, an accepted navigation contract and Cloudflare
  qualification: `demo-aesthetics` `/journal/:slug` as a `PostDetails` server component reading
  posts, author and media through the Local API, with a small interactive Angular island. Documented
  only; no code exists.

## Request lifecycle (the core data flow)

```
Browser (admin UI / CmsApiService)
  → HTTP  /api/v1/posts?limit=10
  → Analog/Nitro h3 route file        apps/www/src/server/routes/api/v1/[collection].get.ts
      (thin: builds ApiContext { request, params, env } from the h3 event)
  → runtime handler                   @forge-cms/runtime handleList(context, { runtime })
      1. optional auth (adapters.auth.requireAuth)
      2. resolve collection by slug (runtime.getCollection)
      3. parse limit/offset/where/sort/order/depth from query params
      4. validation on write paths (validateCollection from @forge-cms/core)
      5. adapters.database.findMany/create/update/delete
  → Response (web standard)           JSON envelope, framework-agnostic
```

Key design decision: **runtime handlers accept an `ApiContext` and return a standard `Response`**,
so they contain no h3/Analog specifics. The h3 route files in apps/www are deliberately thin
adapters. Keep it that way — new HTTP behavior belongs in `@forge-cms/runtime`, not in route files.

## Contracts (stable interfaces — change only via spec)

### DatabaseAdapter (`@forge-cms/db`)

`name`, `init(env)`, `findById(collection, id)`,
`findMany({ collection, limit?, offset?, where?, sort?, order? })`, `create(collection, data)`,
`update(collection, id, partial)`, `delete(collection, id)`, `syncSchema(collections)`, the optional
read-only `planSchema?(collections)` (spec 070, below), the optional migration capability
`runMigrations?(migrations, options)`/`readMigrationHistory?()` (spec 072, below), plus the write
primitives `updateIf`/`deleteIf`
(spec 059) and `atomicWrite` (spec 060) described below. Records are
`Record<string, unknown>` with a string `id` generated by the adapter. `where` values are either a bare
value (`eq`) or an operator object (`{ gt: 10 }`, one or more of `eq`/`ne`/`gt`/`gte`/`lt`/`lte`/`in`/
`contains`, spec 011); predicates across fields and across operators on the same field are AND-ed.
`sort` names one field, `order` is `asc`/`desc`.

Since spec 059 the contract also has **conditional writes**: `updateIf(collection, id, data, condition)`
and `deleteIf(collection, id, condition)`. `condition` (`WriteCondition`) has two optional clauses —
`targetMatches` (per-row compare-and-set) and `keepAtLeast: { where, others }` (the target may leave the
set matching `where` only while at least `others` _other_ rows of the same collection stay in it). The
database evaluates the condition atomically with the write (libSQL and D1: one guarded SQL statement;
InMemory: one synchronous turn, so atomic within one instance only). A missing row or an unmet condition
returns `{ applied: false }` — not an error; a failure rejects and is never reported as "not applied".
It is a single-row primitive, **not a transaction**: on its own nothing here makes a document write and a
version write commit together (see spec 059 §7). It backs `UsersCollectionAuthAdapter`'s last-admin invariant.

Since spec 060 the contract also has an **atomic write batch**: `atomicWrite(operations)` runs an ordered,
declarative list of database writes — `{ type: 'create' | 'update' | 'delete' | 'updateIf' | 'deleteIf',
collection, … }`, one operation per existing method — and **either commits all of them or none**. It is
data only: no callback, no code, hooks or network between statements, and never spanning object storage
(D1 + R2 cannot commit together). Operations run in order and later ones see earlier ones; results come
back in the same order (`{ type, … }`, discriminated). `updateIf`/`deleteIf` reuse `WriteCondition`
unchanged and, unless `requireApplied: true`, may report `applied: false` while the rest still commits;
with `requireApplied` (or a plain `update` of a missing row) the whole batch fails with
`AtomicWriteConditionError` and rolls back. A unique violation rejects with `UniqueConstraintError` (its
`collection` names the conflicting table); invalid input (over `ATOMIC_WRITE_MAX_OPERATIONS` = 25, a
malformed operation, on SQL adapters an unknown column/collection) rejects before anything is written.
libSQL runs one `client.batch(…, 'write')`, D1 one `batch()`, InMemory stages a copy and publishes it in one
synchronous turn (one adapter instance only). A network failure after the request left the process is
outcome-unknown — no exactly-once promise. It backs `UsersCollectionAuthAdapter`'s first-admin
provisioning (claim + admin in one batch) and, since spec 062, every versioned content write (below).
Since spec 064 there is a sixth, read-only operation, `{ type: 'assertCount', collection, where?, equals }`.
It fails the batch unless exactly `equals` rows match at that point of the batch. On SQL it is one
aggregate statement raising the same overflow guard. This is the cross-collection guard relation
integrity commits with (below).

**Relation lifecycle (spec 064, `@forge-cms/runtime`, `relation-lifecycle.ts`).** Supported references are
top-level `relation`/`upload` fields of collections and globals. The `ForgeCmsRuntime` constructor refuses
the rest (`validateRelationSchema`): nested in `group`/`array`/`blocks`, localized, to an unregistered
collection, a global `onDelete` other than restrict, and `cascade`/`set-null` onto an auth-managed target.
A **delete** runs in four phases:

1. `planRelationDelete` works out the graph with bounded reads only (breadth-first over `collection:id`;
   restrict and required set-null judged on the final state; more than 25 operations is refused).
2. `operations.ts` runs every before-hook and validation. Set-null dependents go through the same
   `prepareUpdate` as `update()`.
3. It commits one `atomicWrite`:
   - set-null patches: `updateIf` guarded by the `updated_at` read, or spec 062's update + snapshot;
   - cascaded `deleteIf`s guarded by `updated_at`;
   - the root delete;
   - one `assertCount(…, 0)` per referring field.
4. After the commit: storage cleanup, then after-hooks.

A **write** checks every relation target it changes with one `count` per target collection (`400` if
missing). It carries `assertCount(target, { id: { in } }, n)` in the same batch as the write (and its
snapshot). A delete and a reference write racing on libSQL/D1 therefore serialize: exactly one commits.
Conflicts are `409 CONCURRENT_MODIFICATION`. Dependents keep spec 058's trusted access.

**Document / version history consistency (spec 062, `@forge-cms/runtime`).** A `versions`-enabled
collection's history lives in the internal collection `_versions_<slug>` (`versionCollectionDefinition()`
in `versions.ts`), which carries a compound unique index `(documentId, versionNumber)` and an internal
`snapshotFormat` marker. `operations.create` allocates the document id itself and writes
`[create document, create version 1]` as one `atomicWrite()`; `operations.update` reads the latest version
number **before** the document, runs the unchanged access/validation/hook pipeline, then writes
`[update document, create version N+1]` as one batch. Because every committed versioned mutation commits
its version number with it, a writer that lost a race collides on the unique index and its whole batch
rolls back — surfaced as `ConcurrentModificationError` (409, `CONCURRENT_MODIFICATION`), never retried
automatically (hooks may have side effects). Snapshots are full restorable content (declared fields +
`_status`, never `id`/timestamps/`_storageKey`). `restoreVersion` is still `update()` (spec 058), fed the
difference between the snapshot and the current document, computed inside `update()` after its reads.
Manual `createVersion` is a single insert with a bounded (3-attempt) number-allocation retry. History is
retained indefinitely; deleting a document leaves it orphaned (404 to untrusted readers). Versioned
collections require `atomicWrite()`; `syncSchema()` refuses an adapter without it and reports (never
repairs) pre-062 duplicate version identities that block the index.

**System-field mutation boundary (spec 063, `@forge-cms/runtime`).** `id`, `created_at`, `updated_at`
and `_storageKey` are Forge-owned (`FORGE_OWNED_KEYS`, `system-fields.ts`); `_status` is lifecycle input
on drafts collections/globals. The CMS mutation API (`create`/`update`/`restoreVersion`/`preview`/
`updateGlobal` and every handler) screens caller `data` after the access/row checks and before hooks:
a value equal to the stored one is an echo and is dropped, anything else is `InvalidInputError` (400) —
for every caller, `overrideAccess: true` included (it bypasses authorization, not metadata integrity).
Trusted create may pass an explicit non-empty string `id`, held outside hook `data` and attached at
persistence; untrusted create may not. Hook output is screened after `beforeValidate` and `beforeChange`
(a changed key → plain `Error`, 500). `_storageKey` is merged into the persisted row only by the
package-private `createUpload` (called by `handleCreate`'s multipart branch, not exported from the
package), and `deleteDocument` deletes only that key's object — no URL-derived fallback. The raw
`DatabaseAdapter` is below this boundary by design.

### AuthAdapter (`@forge-cms/auth`)

`name`, `init(env)`, `extractToken(request)`, `validateSession(token)` → `AuthSession | null`,
`requireAuth(request)` → `AuthUser` or throws `ForgeAuthError`. Four optional methods, all additive and
backward compatible — an adapter omitting any of them behaves exactly as if it didn't exist:
`syncSchema?()` (schema/table bootstrap, called by `ForgeCmsRuntime.syncSchema()`), `planSchema?()`
(spec 070: read-only drift plan of those internal tables, merged into `ForgeCmsRuntime.planSchema()`),
`canHandleToken?(token)` (a cheap, synchronous "is this token even shaped like mine?" check;
`CompositeAuthAdapter` consults it to skip a strategy that obviously isn't a token's owner before
paying for a DB round-trip or signature verification), and, since spec 053, `login?(email, password)`
and `signup?(input)` (both return `AuthActionResult` — `{ ok: true, token, user } | { ok: false, reason }`)
— adapters that support password-based browser auth implement these; `packages/runtime`'s
`handleLogin`/`handleSignup` feature-detect them rather than importing a concrete adapter.
One more optional method, since spec 061: `managesCollection?(slug)` — "does this adapter own the
identity and lifecycle of that collection's documents?". `UsersCollectionAuthAdapter` answers `true` for
exactly its configured `collection`; `CompositeAuthAdapter` answers `true` if any child does; adapters
that keep no users in a Forge collection omit it (absent = `false`). `@forge-cms/runtime` consults it —
never a concrete adapter class and never a slug convention — through the **auth-managed-collection
boundary**: `operations.create`/`update`/`deleteDocument` (and therefore `restoreVersion`, relation
cascade/set-null and every HTTP handler) throw `AuthManagedCollectionError` (`403`,
`AUTH_MANAGED_COLLECTION`) for a claimed collection as their first step — before hooks, access checks
and any read or write, for every caller, whatever `overrideAccess` says: `overrideAccess: true` bypasses
_authorization_, not the auth subsystem's data-integrity invariants (first-admin provisioning,
last-admin protection, password hashing, email normalisation, session versioning), which live in exactly
one place, the adapter's `createUser`/`updateUser`/`deleteUser`/`signup`. Reads stay ordinary content
reads. Direct `DatabaseAdapter` access is trusted low-level infrastructure and sits below the boundary.

**Relation guard for auth-managed deletes (spec 065).** The auth adapter owns user deletion, while only
the runtime knows which content fields reference users. So the runtime hands the guard over as data,
and the dependency direction stays `auth → core/db`:

- **Wiring.** At construction, for every registered collection the adapter manages, `ForgeCmsRuntime`
  calls the optional `AuthAdapter.setManagedDeleteGuard(slug, { database, assertions(id) })`.
  `assertions(id)` is `relation-lifecycle.ts`'s `noReferenceAssertions`, the same "no reference
  remains" `assertCount`s a content delete ends its batch with.
- **The delete.** `UsersCollectionAuthAdapter.deleteUser` commits
  `[...assertions, deleteIf(users, id, LAST_ADMIN_GUARD)]` as one `atomicWrite`. Relation integrity and
  the last-admin invariant are therefore decided together, by the database. A failed assertion is
  reported as `UserMutationError('referenced')`. Auth-managed targets are restrict only.
- **Composite and custom adapters.** `CompositeAuthAdapter` forwards the guard to every managing child.
  A managing adapter that cannot accept it makes the runtime refuse to start if its collection is
  referenced.

`UsersCollectionAuthAdapter` and `SignedTokenAuthAdapter`'s shared `extractToken` also falls back to a
`forge_session` cookie (`@forge-cms/auth`'s `cookie.ts`) when no `Authorization` header is present —
`ApiKeyAuthAdapter` keeps its own independent, Bearer-only `extractToken`, unaffected.

`CompositeAuthAdapter` composes multiple `AuthAdapter`s behind one: `requireAuth()` tries each in
order, falling through to the next only on an _expected_ rejection (`ForgeAuthError`) — any other
thrown error (a DB outage, a misconfigured child adapter) propagates immediately rather than being
reinterpreted as "unauthenticated". The HTTP layer (`handlers.ts`) follows the same rule at its own
`auth.requireAuth()` call sites, which is what keeps a database failure a `500` rather than a
misleading `401`. Since spec 069 that propagated error is an `AuthResolutionError` carrying only the
original error's class name, so the `500` log can never quote a credential.

**Auth abuse bounds (spec 069).** The limits are split by who owns the input:

- `@forge-cms/auth` bounds its **own formats and credential operations**. `PasswordPolicy`
  (`minLength`/`maxLength`, default 8–1024) is checked before any PBKDF2. Forge signed tokens
  (≤ 8192 characters) and API keys (≤ 128 characters after the prefix) are refused before decode, HMAC,
  hash or lookup. Signing secrets go through `resolveSigningSecret`: explicit `devMode`, otherwise at
  least 32 bytes. `login` always performs exactly one verification (a dummy hash when no account
  matches). Third-party token formats are not bounded.
- `@forge-cms/runtime` bounds the **HTTP transport**. `readBoundedJsonObject` stream-caps the
  login/signup body (8 KiB, `413 PAYLOAD_TOO_LARGE`). `AuthHandlerOptions.throttle`
  (`AuthAttemptThrottle`) is the one host hook for login/signup limiting (`429 RATE_LIMITED`). It lives
  in the runtime because it needs the `Request` and is invoked by the handlers, and it keeps the graph
  `auth → core/db`, never `auth → runtime`. Forge stores no rate-limit state; platform wiring
  (Cloudflare Rate Limiting binding, WAF rule, proxy, external service) is host code, documented in
  browser-auth.

### StorageAdapter (`@forge-cms/storage`)

See `packages/storage/src/index.ts` — mirror of the others (init + file CRUD).

### API response envelope

- List: `{ data: T[], meta: { collection, count, limit?, offset? } }`
- Item: `{ data: T }` (create → HTTP 201)
- Error: `{ error: { code: string, message: string, details?: unknown } }` with 400/401/403/404/500
  (`403` also carries `AUTH_MANAGED_COLLECTION` for a generic write to an auth-managed collection, spec 061)
- Delete: HTTP 204, empty body

`@forge-cms/angular`'s `CmsApiService` and the admin UI parse exactly this shape.

**Schema-to-wire types (spec 076, `@forge-cms/angular`).** The only edge from `angular` to `core` is
**type-only** (`import type`; `release:verify` fails if angular's packed JS imports core). A consumer
shares `ForgeSchema<typeof collections, [typeof global]>` with the browser and calls
`injectForgeClient<S>()` — the same `CmsApiService` instance, typed. The projections in `schema.ts`
describe the JSON the handlers send, not the server-side value: create/update inputs differ from reads;
dates are ISO strings; `depth: 1` targets may be `null` (many: readable targets only, not populated
further, localized maps kept); a field with an `access.read` rule is optional; localized fields are maps
unless `locale` was requested; writes may answer `{ id }` (spec 068). They rely on the literal option
types `defineField.*` captures. `inject(CmsApiService)` stays the untyped (`UntypedDocument`) client.

### Contract tests

`@forge-cms/testing/contracts` exports `runDatabaseAdapterContractTests` (plus the additive
`runDatabaseAdapterConstraintContractTests`, `runDatabaseAdapterQueryContractTests`,
`runDatabaseAdapterConditionalWriteContractTests` and `runDatabaseAdapterAtomicWriteContractTests`),
`runAuthAdapterContractTests`, `runStorageAdapterContractTests`, `runSchemaDriftContractTests` (spec 070) and `runMigrationContractTests` (spec 072, on-disk libSQL + local D1 through the runtime), and — for the users-collection proofs —
`runLastAdminConcurrencyContractTests` and `runFirstAdminBootstrapContractTests`, both built on the
`createWriteGate` barrier. **Every adapter implementation must
run the matching suite in its test file.** This is what makes adapters swappable with confidence.

## Schema DSL (core concepts)

- `defineField.text({ required: true })` → `FieldDefinition<'text', string, { readonly required: true }>`
  (spec 076: options keep their literal type; still assignable to `TextField`); the phantom `__value`
  carries the value type for inference. A `date` value is an ISO string at rest, on reads and on the
  wire (spec 076); writes also take a `Date` (`FieldInputValue`), canonicalized by the runtime.
- `defineField.richtext()` (spec 015) → value type `RichTextContent` (`RichTextNode[]`), where a node is
  `{ type: string, text?: string, children?: RichTextNode[], ...marks/extra }`. Validated recursively
  (structural only — no fixed node-type vocabulary); stored as JSON text, same pattern as `json`.
- `defineField.upload({ collection })` (spec 016) → a string id referencing a document in the named
  upload-enabled collection; validated and stored exactly like a single `relation`.
- `defineCollection({ slug, fields, hooks?, access?, upload?, drafts? })` → `CollectionDefinition`;
  `CollectionData<typeof col>` infers the record type. `upload: true` (spec 016) marks the collection as
  upload-enabled — `@forge-cms/runtime`'s `handleCreate` then also accepts a `multipart/form-data` body
  (a `file` part, plus any other part matching a declared field) alongside its normal JSON body, uploads
  the file through the configured `StorageAdapter`, and creates the document from whichever of
  `filename`/`url`/`contentType`/`filesize` the collection declares as fields. `hooks.beforeChange`/
  `afterChange` (spec 013) are arrays of functions run in order by `@forge-cms/runtime`'s handlers around
  create/update; a throwing
  `beforeChange` hook rejects the request (`400`), a throwing `afterChange` hook is logged and does not
  fail the (already-succeeded) request. `access.{read,create,update,delete}` (spec 013) are role-name
  arrays that override the route's static `allowedRoles` for that operation when present.
- `drafts: true` (spec 017) adds a system `_status: 'draft' | 'published'` field (never part of
  `collection.fields`, like `id`/`created_at`/`updated_at`) — new documents default to `'draft'`;
  anonymous `GET`s (list and single) only ever see `'published'` documents (a `draft` single read `404`s,
  not `403`, to avoid leaking existence); authenticated requests opt in to drafts via
  `?status=draft`/`?status=all` on list. This is draft/published status only, not version history —
  no past-revision retention, diffing, or restore.
- Field options gain `access.{read,write}` (spec 013, role-name arrays) — `read` hides the field from
  `GET` responses for other roles (including unauthenticated), `write` rejects (`403`) a create/update
  body that sets the field from another role.
- `validateCollection(definition, data)` → `{ valid, errors: ValidationError[] }` used by write handlers.
- `db`'s schema-generator maps field kinds to SQLite column types and generates
  `CREATE TABLE IF NOT EXISTS` (+ indexes for `index: true` / `unique: true`, and for collection-level
  `indexes: [{ fields, unique? }]` compound constraints, spec 046 — one shared `generateIndexSql` used
  by both D1 and libSQL). All DDL derives from one desired model, `desiredTableSchema(collection)`
  (system columns `id`/`created_at`/`updated_at`/`_status`/`_storageKey` + fields + resolved indexes).
  A unique-index conflict on any adapter (including `InMemoryDatabaseAdapter`, which enforces the same
  semantics in-process) surfaces as `@forge-cms/runtime`'s `UniqueConstraintError` (`409`, code
  `UNIQUE_CONSTRAINT`).

**Schema drift planning (spec 070, roadmap 0.7 M01, `@forge-cms/db`).** `syncSchema` no longer runs
optimistic `IF NOT EXISTS` DDL. The flow:

1. The SQL adapters read the stored schema through a two-method `SqliteSchemaExecutor` (`query`,
   transactional `batch`), using `pragma_table_info`/`pragma_index_list`/`pragma_index_info` with
   bound names.
2. The shared `planSqliteSchema` compares it with the desired model and the per-table semantic
   baseline in `_forge_schema`. It compares types by SQLite affinity and indexes by ordered columns
   plus uniqueness, never by name alone. SQL aggregate probes (row/NULL/draft counts, duplicate
   groups excluding NULLs) settle the data-dependent cases.
3. Every difference becomes a `SchemaChange` classified `safe-additive`, `manual-migration`,
   `unsupported` or `informational`, in a deterministically ordered `SchemaPlan`.
4. `syncSqliteSchema` throws `SchemaDriftError` (nothing executed) when anything blocks. Otherwise it
   runs the safe DDL and the baseline upserts as one transaction.

`ForgeCmsRuntime.planSchema()` plans every table the runtime syncs (collections, `_global_*`,
`_versions_*`, `_forge_storage_intents`) and merges `AuthAdapter.planSchema?()`
(`_forge_bootstrap`, `_forge_api_keys`). `runtime.syncSchema()` refuses before any adapter sync, so
a blocker anywhere prevents partial DDL everywhere. `planSchema()` refuses an adapter that cannot
inspect its schema. Never drops, renames, retypes, rebuilds or backfills. Consumer-facing
classification: [SCHEMA-UPGRADES.md](SCHEMA-UPGRADES.md).

**Reviewed migrations (spec 072, roadmap 0.7 M02).** The changes `syncSchema` refuses are applied by
explicit, reviewed migrations. The design mirrors M01: shared engine, thin adapter bindings.

- **Definitions** (`@forge-cms/db`, `migrations.ts`, pure). `defineMigration({ id, description,
destructive, statements: [{ sql, args? }], resetBaseline? })` is data, not a callback, because D1 has
  no interactive transaction. Validation happens before any I/O: one statement each, positional `?`
  only, no transaction control, no Forge-owned tables. A SHA-256 checksum (Web Crypto) covers the
  canonical id, destructive flag, sorted baseline resets and SQL + typed args, but not the
  description. `planMigrationHistory` enforces an exact append-only prefix and matching checksums.
- **Engine** (`sqlite-migrations.ts`, over the same `SqliteSchemaExecutor`).
  - **Ledger.** `_forge_migrations` is an ordinary Forge table created by `syncSqliteSchema` with only
    its own definition. So it works while app tables are blocked, and it refuses a drifted ledger.
  - **One batch per migration:** prefix guard → claim (`INSERT`, unique id and position; or a guarded
    retry/replace of a recorded failure) → `_forge_schema` resets → the statements → `applied`
    transition. The guards reuse spec 060's `abs(MIN_INT)` trick.
  - **After a failed batch, a fence.** The runner commits a `failed` row that conflicts with every
    committed or late claim, which proves the attempt rolled back. If the fence cannot commit, a
    reconcile read decides between applied (`reconciled`), known failed, divergent, and
    `MIGRATION_OUTCOME_UNKNOWN`. Nothing retries automatically: `retryFailed`/`replaceFailed` and
    `allowDestructive` are explicit.
- **Entry point.** `ForgeCmsRuntime.runMigrations()` runs `planSchema()` → adapter `runMigrations` →
  post-flight `syncSchema()` + `planSchema()`. A post-flight failure is `MIGRATION_POSTFLIGHT_FAILED`
  and states that the migrations committed. `planMigrations()` and `readMigrationHistory()` are
  read-only. `init()`/`syncSchema()` never run migrations. InMemory and custom adapters without the
  capability get `MIGRATION_UNSUPPORTED`. No down migrations, no CLI.

**Upgrade and recovery rehearsal (spec 073, roadmap 0.7 M03).** No package code: a private workspace,
`apps/upgrade-rehearsal`, consumes the public entry points only. Committed fixtures hold databases and
objects written by the published `0.4.0`, `0.6.0` and `0.8.0` packages. `pnpm test:upgrade` upgrades
each one through `planSchema()` → `runMigrations()` on on-disk libSQL and on local D1/R2 (Miniflare
bindings, pinned Wrangler for `d1 export`/`d1 execute --local`), then backs the result up and restores
it into an isolated, empty environment. A backup's object set comes from the `_storageKey` columns of
the database snapshot, never from `StorageAdapter.list()`. The operator runbook is
[BACKUP-RESTORE.md](BACKUP-RESTORE.md).

## Build & tooling architecture

- **Turbo** orders tasks: `build`/`typecheck`/`test` depend on `^build` because
  `tsconfig.base.json` resolves `@forge-cms/*` to each package's `dist/index.d.ts`. Fresh clone →
  run `pnpm build` first.
- Packages build with plain `tsc -p tsconfig.build.json` to `dist/` (ESM + d.ts). No bundler.
- Apps build with Vite/Analog (`.analog/` + `dist/`); www's client output deploys to Cloudflare Pages
  (`wrangler.toml` → `apps/www/dist/client`).
- Tests: Vitest everywhere, colocated `*.test.ts`; Playwright for www e2e.
- Versioning: Changesets (`.changeset/`), npm scope `@forge-cms`, public access.
