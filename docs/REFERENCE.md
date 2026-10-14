# Reference — packages, entry points, options and defaults

The human-readable companion to the machine-checked export inventory in [`api-baseline/*.json`](../api-baseline/) (`pnpm check:api` compares it with the built packages;
`pnpm docs:verify` checks that this page covers every entry point and attributes no export to the wrong package). Names are not signatures: this page records
**responsibility, options, defaults, environment, errors and stability**. It is deliberately not a copy of the declaration files — your editor shows the types.

Stability vocabulary (see [SUPPORT.md](SUPPORT.md)): **stable** = covered by the 1.0 compatibility promise · **experimental** = public but outside it ·
**deprecated** = still works, removed after 1.0. Defaults in the frozen client/admin contract are in [1.0-PUBLIC-SURFACE.md](1.0-PUBLIC-SURFACE.md).

All twelve packages are ESM-only, share one version, and are imported only through the entry points below. `@forge-cms/agent` is experimental development tooling.

| Entry point                    | Boundary              | Stability                               |
| ------------------------------ | --------------------- | --------------------------------------- |
| `@forge-cms/core`              | isomorphic            | stable                                  |
| `@forge-cms/db`                | server only           | stable                                  |
| `@forge-cms/auth`              | server only           | stable                                  |
| `@forge-cms/storage`           | server only           | stable                                  |
| `@forge-cms/s3`                | server only (secrets) | stable                                  |
| `@forge-cms/api`               | types                 | stable                                  |
| `@forge-cms/runtime`           | server only           | stable                                  |
| `@forge-cms/cloudflare`        | server only           | stable (Analytics Engine: experimental) |
| `@forge-cms/angular`           | browser + SSR         | stable (Analytics: experimental)        |
| `@forge-cms/angular/server`    | server rendering only | stable                                  |
| `@forge-cms/angular/vite`      | build time            | stable                                  |
| `@forge-cms/admin`             | browser               | stable (Analytics: experimental)        |
| `@forge-cms/admin/vite`        | build time            | stable                                  |
| `@forge-cms/testing`           | dev/test only         | stable                                  |
| `@forge-cms/testing/contracts` | dev/test only         | stable                                  |
| `@forge-cms/agent`             | dev time only         | **experimental**                        |

## `@forge-cms/core`

**Responsibility.** The schema DSL and runtime validation. Pure and isomorphic.

**Main exports.** `defineCollection`, `defineGlobal`, `defineBlock`, `defineField` (one factory per kind: `text`, `textarea`, `number`, `boolean`, `date`, `email`, `select`, `slug`,
`json`, `richtext`, `relation`, `upload`, `group`, `array`, `blocks`); `validateCollection`, `validateField`, `validateFieldMap`; `slugify`; the `AccessFn`/`AccessRule` and
`FieldAccess` types; the hook types (`BeforeValidateHook`, `BeforeChangeHook`, `AfterChangeHook`, `BeforeReadHook`, `AfterReadHook`, `BeforeDeleteHook`, `AfterDeleteHook`,
`BeforeOperationHook`, `AfterOperationHook`); inference helpers `CollectionData`, `CollectionInput`, `CollectionDocument`; `setLogger`, `getLogger`, `consoleLogger`,
`createSilentLogger`.

**Important options.**

| Option                                                                             | Default  | Meaning                                                                                                                      |
| ---------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| collection `slug`                                                                  | —        | Required; a valid identifier. Slugs starting with `_forge` are reserved                                                      |
| collection `fields`                                                                | —        | Field map; names are identifiers                                                                                             |
| collection `drafts`                                                                | `false`  | Adds `_status` (`draft`/`published`); drafts are hidden from callers who cannot see them                                     |
| collection `upload`                                                                | `false`  | `POST` also accepts `multipart/form-data` (part `file`)                                                                      |
| collection `access`                                                                | allow    | Per-operation functions returning `boolean` or a query; see [access control](../apps/www/src/content/docs/access-control.md) |
| collection `hooks`, `indexes`, `admin` (`useAsTitle`, `defaultColumns`), `locales` | none     | See the [collections guide](../apps/www/src/content/docs/collections.md)                                                     |
| field `required`, `defaultValue`, `unique`, `index`, `label`, `access`, `hooks`    | off/none | Base options of every kind; `defaultValue` applies on **create** only                                                        |
| field `localized`                                                                  | `false`  | Only top-level `text`/`textarea` in a collection/global that declares `locales`                                              |

**Errors.** Validation returns `ValidationError` items `{ field, message, code }` with code `required` or `type_<kind>`; invalid definitions throw at startup
(for example an unsupported relation inside a `group`, or a localized field of another kind).

**Stability.** Stable. See the [field matrix](MATRICES.md#field-support-matrix) for per-kind behaviour.

## `@forge-cms/db`

**Responsibility.** The `DatabaseAdapter` contract, reference adapters, schema planning and reviewed migrations.

**Main exports.** `DatabaseAdapter`, `InMemoryDatabaseAdapter` (dev/test), `LibSqlDatabaseAdapter` (libSQL, Turso or a local file), `planSqliteSchema`, `syncSqliteSchema`,
`formatSchemaPlan`, `SchemaDriftError`, `isSchemaDriftError`, `defineMigration`, `MigrationError`, `isMigrationError`, `runSqliteMigrations`, `readSqliteMigrationHistory`,
`migrationChecksum`, `UniqueConstraintError`, `WHERE_OPERATORS`.

**Important options.** `new LibSqlDatabaseAdapter(url?)`: `url` defaults to `file:./forge-cms.db`; `DATABASE_URL` in the `env` given to `init()` overrides it. `@libsql/client` loads on
the first operation, so `init()` never opens the database and a bad URL rejects the first call. `RunMigrationsOptions`: `allowDestructive` (default `false`), `retryFailed`, `replaceFailed`.

**Environment.** `DATABASE_URL`. An on-disk file must live on a persistent volume.

**Errors.** `SchemaDriftError` (`code: 'SCHEMA_DRIFT'`, a `plan` listing every change); `MigrationError` with `MIGRATION_INVALID`, `MIGRATION_UNSUPPORTED`, `MIGRATION_HISTORY_MISMATCH`,
`MIGRATION_CHECKSUM_MISMATCH`, `MIGRATION_RETRY_REQUIRED`, `MIGRATION_REVIEW_REQUIRED`, `MIGRATION_EXECUTION_FAILED`, `MIGRATION_OUTCOME_UNKNOWN`, `MIGRATION_POSTFLIGHT_FAILED`.

**Stability.** Stable. The in-memory adapter does not implement migrations.

## `@forge-cms/auth`

**Responsibility.** The `AuthAdapter` contract and its implementations: users in your database with cookie sessions, scoped API keys, composite and external-token auth.

**Main exports.** `UsersCollectionAuthAdapter`, `defineUsersCollection`, `withAuthFields`, `ApiKeyAuthAdapter`, `CompositeAuthAdapter`, `SignedTokenAuthAdapter`, `ExternalAuthAdapter`,
`InMemoryAuthAdapter`, role/scope helpers (`hasRole`, `hasAnyRole`, `isAdmin`, `canWriteContent`, `hasScope`, `hasAllScopes`, `hasAnyScope`), cookie helpers (`buildSessionCookie`,
`buildLogoutCookie`, `parseCookieToken`, `SESSION_COOKIE_NAME`), `extractBearerToken`, `UserMutationError`.

**Important options.**

| Option                                   | Default          | Meaning                                                                                  |
| ---------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `devMode`                                | `false`          | Explicit opt-in to Forge's public dev secret; never derive it from a missing secret      |
| `passwordPolicy.minLength` / `maxLength` | `8` / `1024`     | Integers; `maxLength` ceiling 4096; applied on create, signup, password change and login |
| `collection`                             | `users`          | Must match the slug given to `defineUsersCollection()`/`withAuthFields()`                |
| `AUTH_SECRET` (env)                      | required         | At least 32 bytes; signs session tokens (24-hour lifetime)                               |
| roles                                    | `viewer` default | `admin` · `editor` · `viewer`; the very first user ever created is always `admin`        |

**Behaviour worth knowing.** Passwords: PBKDF2-HMAC-SHA256, 100,000 iterations. Every request re-reads the user row (role changes apply at once; a deleted user's session fails). A
password change invalidates every earlier session (`_sessionVersion`). The users collection is managed by the adapter: generic create/update/delete on it is refused with
`AUTH_MANAGED_COLLECTION`. The last admin cannot be removed or demoted, including under concurrency. API-key secrets are shown once and stored hashed.

**Errors.** Failed creation/updates return `AuthFailureReason` values or throw `UserMutationError` (reasons such as `referenced`, last-admin); HTTP mapping is in the runtime section.

**Stability.** Stable.

## `@forge-cms/storage`

**Responsibility.** The `StorageAdapter` contract (`init`, `put`, `get`, `delete`, `getPublicUrl`, `list`) and `InMemoryStorageAdapter` (dev/test only — loses data on restart).

**Main exports.** `StorageAdapter`, `InMemoryStorageAdapter`, `PutObjectOptions`, `StorageObject`. A new adapter must pass the storage contract suite (see the testing section).

**Stability.** Stable.

## `@forge-cms/s3`

**Responsibility.** `S3StorageAdapter`: the S3 API through AWS SDK v3, server-side only. The adapter reads no environment variables; your server passes values in.

**Main exports.** `S3StorageAdapter`, `S3StorageAdapterOptions`, `S3StorageCredentials`.

**Important options.**

| Option           | Default              | Meaning                                                                                              |
| ---------------- | -------------------- | ---------------------------------------------------------------------------------------------------- |
| `bucket`         | required             | Existing bucket; Forge never creates buckets or policies                                             |
| `region`         | required, no default | Signing region (Garage publishes its own value)                                                      |
| `endpoint`       | AWS S3               | Absolute `http(s)` URL of an S3-compatible service; `http:` for local/test only                      |
| `credentials`    | SDK provider chain   | `{ accessKeyId, secretAccessKey, sessionToken? }`                                                    |
| `forcePathStyle` | `false`              | Many self-hosted services need `true`                                                                |
| `publicUrlBase`  | `/api/media`         | Base of `getPublicUrl()`; a direct bucket/CDN base bypasses the runtime file handler's access checks |

**Errors.** A missing object reads as `null` (HTTP 404 from the runtime file handler); an unreachable bucket or rejected credentials surface as a generic `500` that names no bucket, endpoint or key.

**Certification.** Garage `v2.4.1` only. AWS S3, Backblaze B2 and Wasabi are configurable, **not certified**.

**Stability.** Stable.

## `@forge-cms/api`

**Responsibility.** `ApiContext` — `{ request: Request, params?, env }` — and the handler contract types, so framework glue need not import the runtime.

**Main exports.** `ApiContext`, `CrudHandlerConfig`, `CrudHandlers`, `defineCrudHandlers`.

**Stability.** Stable. The response envelope is a contract: list `{ data, meta }`, item `{ data }`, error `{ error, details? }`, delete `204`.

## `@forge-cms/runtime`

**Responsibility.** `ForgeCmsRuntime` (the Local API and the whole operation pipeline) and the framework-agnostic HTTP handlers.

**Main exports.**

- Class: `ForgeCmsRuntime` — `init()`, `syncSchema()`, `planSchema()`, `runMigrations()`, `reconcileStorage()`, `find`, `findOne`, `findByID`, `count`, `create`, `update`, `delete`,
  versions and globals, `preview`, `getCollections()`.
- Handlers: `handleList`, `handleRead`, `handleCreate`, `handleUpdate`, `handleDelete`, `handleFile`, `handleLogin`, `handleSignup`, `handleLogout`, `handleMe`, `handleListVersions`,
  `handleGetVersion`, `handleRestoreVersion`, `handlePreview`, `handleGlobalRead`, `handleGlobalUpdate`.
- Helpers: `describeCollections`, `describeCollection`, `assertCsrfSafe`, `readBoundedJsonObject`, `isForgeError`, `toApiErrorBody`.

**Important options and defaults.**

| Option                                                          | Default                               | Meaning                                                                                  |
| --------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ForgeCmsConfig`: `collections`, `globals?`, `adapters`, `env?` | —                                     | `adapters` = `{ database, auth, storage }`                                               |
| Local API `overrideAccess`                                      | `true`                                | Trusted server code. Pass `false` and a `user` to enforce access                         |
| HTTP handlers                                                   | access always enforced                | A caller can never set `overrideAccess`                                                  |
| list `limit`                                                    | `50` (max `500`)                      | Also `page`, `sort`, `where`, `depth` (only `0` or `1`), `locale`                        |
| handler options                                                 | —                                     | `allowedRoles`, `requireAuth`, `upload.maxFileSize`, `upload.mimeTypes` (no default cap) |
| `handleFile` `cacheControl`                                     | `public, max-age=60`                  | Anonymous hits only; authenticated hits are always `private, no-store`                   |
| auth handlers `cookie.secure`                                   | `true`                                | `false` only for local `http://` development                                             |
| auth handlers `maxBodyBytes`                                    | `DEFAULT_AUTH_MAX_BODY_BYTES` = 8 KiB | Integer 1–1 MiB (`413 PAYLOAD_TOO_LARGE` when exceeded)                                  |
| auth handlers `throttle`                                        | none                                  | Your attempt limiter (`AuthAttemptThrottle`); `429 RATE_LIMITED`                         |
| signup `enabled`                                                | required (`false` = `404`)            | Public signup is opt-in                                                                  |
| `reconcileStorage` `uploadGraceMs` / `limit`                    | 1 hour / 100                          | Safe to run repeatedly and concurrently                                                  |

**Errors.** `ForgeError` subclasses carry `status` and `code`: `NOT_FOUND` 404, `INVALID_INPUT` 400, `INVALID_QUERY` 400, `UNKNOWN_FIELD` 400, `VALIDATION_ERROR` 400 (with `details`),
`UNAUTHORIZED` 401, `FORBIDDEN` 403 (`AccessDeniedError`, `CsrfError`), `UNIQUE_CONSTRAINT` 409, `CONCURRENT_MODIFICATION` 409, `AUTH_MANAGED_COLLECTION` 403, `PAYLOAD_TOO_LARGE` 413,
`RATE_LIMITED` 429, `INTERNAL_ERROR` 500 (generic text; no driver message is returned).

**Metadata privacy.** `describeCollections` and the metadata endpoint omit fields no role can read or write (`access: { read: [], write: [] }`, such as the users collection's
`passwordHash` and `_sessionVersion`) — fixed in `0.13.3`; before it, anonymous metadata listed those field **names** (never values).

**Stability.** Stable.

## `@forge-cms/cloudflare`

**Responsibility.** Cloudflare D1 database and R2 storage adapters (plus an experimental Analytics Engine writer/query client).

**Main exports.** `D1DatabaseAdapter`, `R2StorageAdapter`, the binding types `D1Database`, `R2Bucket`, `CloudflareEnv`; experimental: `AnalyticsEngineWriter`,
`AnalyticsEngineQueryClient`, `NoopAnalyticsWriter`.

**Important options.** `new D1DatabaseAdapter({ binding })` — `binding` defaults to `DB`. `new R2StorageAdapter({ binding, publicUrlBase })` — `binding` defaults to `BUCKET`,
`publicUrlBase` defaults to `/api/media` (a direct bucket or CDN URL bypasses the runtime file handler's access checks). Both require the binding in `env` at `init()`.

**Notes.** No KV adapter exists. A very long `in` list is sent as one JSON parameter (fixed in `0.13.2`). Never use an in-memory fallback selector in production.

**Stability.** Stable; Analytics is experimental and may change in any release.

## `@forge-cms/angular`

**Responsibility.** The browser/SSR client: transport, typed client, session, route guard, signal resources.

**Main exports.** `provideForgeCms`, `CmsApiService`, `injectForgeClient`, `ForgeSchema`, `collectionResource`, `documentResource`, `ForgeAuthSession`, `forgeAuthGuard`, `ForgeApiError`,
`isForgeApiError`, `buildQueryString`, `encodePathSegment`, role helpers (`isAdmin`, `canWriteContent`, `canManageUsers`, `userRole`, `USER_ROLES`); experimental:
`provideForgeAnalytics`, `ForgeAnalyticsApiService`, `ForgeAnalyticsTracker`.

**Important options.** `provideForgeCms(config?)` — all keys optional:

| Key              | Default     | Meaning                                                                     |
| ---------------- | ----------- | --------------------------------------------------------------------------- |
| `baseUrl`        | `/api/v1`   | Content API base (relative or absolute; trailing slash ignored)             |
| `authBaseUrl`    | `/api/auth` | Auth API base                                                               |
| `credentials`    | `'include'` | `'omit'` for Bearer-only/anonymous clients; other origins never get cookies |
| `trustedOrigins` | none        | Extra absolute origins allowed to receive cookies/Bearer                    |
| `authToken`      | none        | Bearer token or a function returning one                                    |
| `transport`      | `fetch`     | Replacement transport; it must not retry                                    |

`forgeAuthGuard({ roles?, signInPath = '/admin/login', forbiddenPath = '/admin' })`. A route-level `provideForgeCms` replaces (does not merge with) the app-level one.

**Errors.** Every failure is a `ForgeApiError` with `kind` (`http` · `network` · `aborted` · `invalid-response`), `status`, `code`, `details`. Relative URL during SSR without server config:
`code: 'SERVER_ORIGIN_REQUIRED'`. A `/me` outage puts `ForgeAuthSession` in `'error'`, not `'anonymous'`. Writes are never retried.

**Stability.** Stable; Analytics exports are experimental.

### `@forge-cms/angular/server`

`provideForgeCmsServer({ origin, forwardCookies = [], forwardAuthorization = false })` — the request-scoped SSR transport. `origin` is an absolute `http(s)` origin and is **never** derived
from the incoming `Host`. Provide it per render in `main.server.ts` (the `ForgeServerConfig` type). Server rendering only. Stable.

### `@forge-cms/angular/vite`

`angularLinker()` — the official Angular partial-Ivy linker plugin, build time only. Needs `@angular/compiler-cli`, `@babel/core` (7 for Angular 21, 8 for 22) and `vite`. The only supported
linker; copying a private plugin is unsupported. Stable.

## `@forge-cms/admin`

**Responsibility.** The reusable Angular admin: layout, content workspace and editor, auth pages, users workspace, route helpers. It contains no API URL and no server code.

**Main exports.** `forgeAdminContentRoutes()`, `forgeAdminAuthRoutes(options?)`, `ForgeAdminLayoutComponent`, `ForgeSignInComponent`, `ForgeSignUpComponent`, `ForgeUsersWorkspaceComponent`,
`ForgeCollectionsIndexComponent`, `ForgeCollectionWorkspaceComponent`, `ForgeDocumentEditorComponent`, `canDeactivateForgeDocumentEditor`, `ForgeFieldControlComponent`, the pickers and state
components, `DEFAULT_ADMIN_NAV`, `ForgeAdminConfig`; experimental: `forgeAdminAnalyticsRoutes`, `ForgeAnalyticsDashboardComponent`.

**Important options and defaults.** Mount root `basePath` `/admin`; `forgeAdminAuthRoutes({ signup = false, basePath = '/admin' })`; `ForgeAdminConfig`: `title` (`ForgeCMS`), `basePath`, `nav`
(default: Collections + admin-only Users), `collections` (all), `signInPath` (`{basePath}/login`); `logo` and `features` are **deprecated** no-ops. The host must use
`provideRouter(..., withComponentInputBinding())`. Full contract: [1.0-PUBLIC-SURFACE.md](1.0-PUBLIC-SURFACE.md).

**Peers.** `@angular/{cdk,common,core,forms,platform-browser,router}` `^21.2.0`, `rxjs ^7.8.0`, `@voltui/components ^1.0.1`, `lumen-icons ^0.2.0`. Angular 22 is not supported for the admin.

**Stability.** Stable; Analytics experimental.

### `@forge-cms/admin/vite`

The same `angularLinker()` re-exported so admin consumers need one import. Stable.

## `@forge-cms/testing`

**Responsibility.** Test helpers (`createTestCollection`, `createTestRequest`). Development dependency only. Stable.

### `@forge-cms/testing/contracts`

The adapter contract suites an adapter must pass: `runDatabaseAdapterContractTests` (and the query, constraint, conditional-write and atomic-write suites), `runAuthAdapterContractTests`,
`runStorageAdapterContractTests`, `runAnalyticsWriterContractTests`, and the behavioural suites `runSchemaDriftContractTests`, `runMigrationContractTests`, `runVersionHistoryContractTests`,
`runRelationLifecycleContractTests`, `runLocaleMergeContractTests`, `runWriteAccessContractTests`, `runGlobalLifecycleContractTests`, `runFirstAdminBootstrapContractTests`,
`runLastAdminConcurrencyContractTests`, `runAuthManagedDeleteContractTests`. The suites use Vitest globals. Stable.

## `@forge-cms/agent`

**Experimental development tooling** - outside the stable 1.x compatibility promise (tool names, resource ids and skill names may change in a compatible minor). Dev dependency only: no Forge package, no application and no browser bundle may depend on it.
Node >= 22, ESM. Binary: `forge-cms-mcp` (`pnpm exec forge-cms-mcp [--root <dir>]`), a **read-only, local, stdio** MCP server with no telemetry. Guide: [Agent Kit](../apps/www/src/content/docs/agent-kit.md).

**Programmatic surface.** `createForgeMcpServer({ projectRoot })` returns the server; `detectProject(root)`, `doctorProject(root)`, `searchDocs(query, limit?)`, `listDocs()`, `supportFacts(version)` and `fetchRuntimeMetadata(origin)` are the functions behind the tools.

**MCP tools** (all read-only, none takes a path): `forge_project_detect`, `forge_project_doctor`, `forge_docs_search`, `forge_support`, `forge_runtime_metadata`.
**MCP resources:** `forge://docs/<guide>`, `forge://skills/<skill>`, `forge://support`, `forge://project`.
**Skills** (shipped as `skills/<name>/SKILL.md`): `forgecms-setup`, `forgecms-content-modeling`, `forgecms-admin`, `forgecms-localization`, `forgecms-auth-access`, `forgecms-cloudflare`, `forgecms-analytics`, `forgecms-migrations-recovery`.
