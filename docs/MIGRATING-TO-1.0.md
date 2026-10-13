# Migrating an existing 0.x application to 1.0

The question this page answers: **what must an existing 0.x ForgeCMS application review or change before adopting 1.0?** It lists consumer-visible changes that remain relevant, grouped by
area, with the release that introduced them. It is not a changelog — per-package history is in each `CHANGELOG.md` — and it does not repeat changes that were already invisible to consumers.

1.0 itself is **not released yet**: the frozen candidate surface is the `0.13.x` line ([1.0-PUBLIC-SURFACE.md](1.0-PUBLIC-SURFACE.md)). If you are on `0.13.3` there is nothing to do for 1.0 beyond
what the release notes of the release candidate say; if you are on an older line, work through the sections below, upgrading all eleven `@forge-cms/*` packages together (they are one fixed version).

**How to upgrade safely:** back up first ([BACKUP-RESTORE.md](BACKUP-RESTORE.md)), upgrade to the latest `0.13.x`, run `pnpm build` and your tests, call `runtime.planSchema()` against a copy of
production data, then deploy. Historical installations written by `0.4.0`, `0.6.0` and `0.8.0` are upgraded and restored in CI (`pnpm test:upgrade`).

## Checklist

| #   | Area                                  | Review if you…                                               | Introduced        |
| --- | ------------------------------------- | ------------------------------------------------------------ | ----------------- |
| 1   | Schema sync refuses unsafe drift      | changed collections on a database that has data              | `0.8.0`           |
| 2   | Reviewed migrations                   | renamed/retyped/dropped fields                               | `0.8.1`           |
| 3   | Date values are ISO strings           | read `date` fields as `Date` from the Local API              | `0.9.0` line      |
| 4   | Angular transport and errors          | catch errors from `CmsApiService`, or call another origin    | `0.9.0` line      |
| 5   | Typed client                          | used `getDocument<Post>(…)` generics                         | `0.9.0` line      |
| 6   | Resource contract                     | relied on stale `value()` or on cross-user data in resources | `0.9.0` line      |
| 7   | SSR server provider                   | server-render Angular pages                                  | `0.10.x`          |
| 8   | Public transfer / hydration           | want server-fetched data reused in the browser               | `0.10.x`          |
| 9   | `@forge-cms/s3`                       | want durable files off Cloudflare                            | `0.11.0`          |
| 10  | Upload ownership and storage intents  | have older media documents or delete files                   | earlier 0.x       |
| 11  | Admin reliability (U01)               | embed admin pieces or guard `canDeactivate`                  | `0.12.0`          |
| 12  | Admin focus, errors, dates (U02)      | host the editor, or use `withTime` dates                     | `0.12.1`          |
| 13  | `@angular/cdk` peer                   | use `@forge-cms/admin`                                       | `0.12.1`          |
| 14  | Custom mount (`basePath`)             | mount the admin somewhere other than `/admin`                | `0.13.0`          |
| 15  | Final default navigation              | relied on Dashboard/Media/API/Settings in the default nav    | `0.13.0`          |
| 16  | Deprecated `logo` / `features`        | set them in `ForgeAdminConfig`                               | `0.13.0`          |
| 17  | Content and auth API defaults         | depended on other base URLs                                  | frozen `0.13.0`   |
| 18  | Auth and users hardening              | write the users collection generically; rely on a dev secret | earlier 0.x       |
| 19  | Compatibility fixes `0.13.1`–`0.13.3` | use D1 with long lists, offsets, or read collection metadata | `0.13.1`–`0.13.3` |

## Data and operations

### 1–2. Schema drift and reviewed migrations

`runtime.syncSchema()` used to create tables and add columns and silently leave everything else. Since `0.8.0` it **plans first**: safe additive changes run in one transaction; anything that would
drop, rename, retype, reinterpret or backfill data throws `SchemaDriftError` with nothing executed. Review: run `runtime.planSchema()` in a deploy check; apply refused changes with
`runtime.runMigrations([...])` (`defineMigration`, single SQL statements, `destructive: true` needs `allowDestructive`) from a deploy script — **never at startup**. The ledger is append-only and
checksummed (`MIGRATION_CHECKSUM_MISMATCH`, `MIGRATION_HISTORY_MISMATCH`). There are no down migrations: forward-fix or restore. Details: [SCHEMA-UPGRADES.md](SCHEMA-UPGRADES.md).

### 3. Date wire types

Date fields are ISO-8601 strings (`toISOString()` form) everywhere: database, Local API reads, HTTP. Earlier Local API reads on libSQL/D1 could return a `Date`. Review any code that calls `Date`
methods on a read value: wrap it in `new Date(value)`. Writes still accept a `Date` or a parseable string.

### 10. Upload ownership and storage intents

A file is served and deleted only through the document that owns its key (`_storageKey`), set only by the multipart upload pipeline; the old guess from `url` was removed. Review: media created before
`_storageKey` existed have no owner and return `404` from the file route; backfill `_storageKey` (the part of `url` after your media route) to serve them, and delete their objects by hand. Run
`runtime.reconcileStorage()` on a schedule. Keep buckets private and mount the file route; a direct `publicUrlBase` bypasses access checks.

### 9. Portable storage

`@forge-cms/s3` (`0.11.0`) adds the portable profile. Nothing changes for Cloudflare projects. A new portable project: [deployment](../apps/www/src/content/docs/deployment.md).

## Angular client

### 4–6. Transport, errors, typing, resources

- Every failure is a `ForgeApiError` (`kind`, `status`, `code`, `details`) instead of a plain `Error` ending in `: <status>`. Replace message-string checks with `isForgeApiError()` / `error.status`.
- `getCurrentUser()` resolves `null` only for a 401 and throws for 403/5xx/network; `ForgeAuthSession` shows `'error'`, not `'anonymous'`, on an outage.
- Cookies and the Bearer token go only to same-origin/relative URLs and origins listed in `trustedOrigins`. An absolute `baseUrl` on another origin needs it (and CORS with credentials).
- The per-method generic is gone: `getDocument<Post>(…)` no longer compiles. Use `injectForgeClient<SiteSchema>()` with `ForgeSchema<typeof collections>` (erased at build time), or the untyped
  `CmsApiService`. `collectionResource<Post>(…)` becomes `collectionResource<SiteSchema, 'posts'>(…)`.
- Resources abort superseded requests, never let an old response overwrite a newer one, and reset `value()` on identity change; nothing is retried. Code that relied on stale data surviving a sign-out must change.
- `baseUrl` is optional (defaults `/api/v1`; `authBaseUrl` `/api/auth`).

### 7–8. SSR

Server rendering needs `provideForgeCmsServer({ origin })` per render (an explicit absolute origin, never the `Host` header). Without it a relative request fails with `SERVER_ORIGIN_REQUIRED`. Public data is
transferred to the browser only for resources that opt in with `{ transfer: 'public' }` and a `credentials: 'omit'` client; identity is forwarded only when you list cookie names. Guide:
[SSR](../apps/www/src/content/docs/ssr.md).

## Admin

### 11–13. Reliability, focus and the CDK peer

- `ForgeDocumentEditorComponent.canDeactivate()` returns `boolean | Promise<boolean>`: `await` it in a host guard. `window.confirm` is gone; the editor uses Forge's own dialog.
- Saves are single-shot, a failed save keeps the form, and a `401` blocks further saves until sign-in. New component inputs are optional.
- `defineField.date({ withTime: true })` now reaches the field metadata, so the admin shows a `datetime-local` control.
- **Install `@angular/cdk ^21.2.0`** — a direct peer of `@forge-cms/admin` since `0.12.1`. The admin requires Angular 21; Angular 22 is not supported for the admin.

### 14–17. The frozen surface (U03)

- Custom mount: set the same root in `ForgeAdminConfig.basePath`, `forgeAdminAuthRoutes({ basePath })` and the guard's `signInPath`/`forbiddenPath`; the API bases come only from `provideForgeCms()`. `/admin` hosts change nothing.
- `DEFAULT_ADMIN_NAV` is now exactly **Collections** and the admin-only **Users**. If you relied on Dashboard/Media/API/Settings defaults, list them in `ForgeAdminConfig.nav`.
- `ForgeAdminConfig.collections` takes `ReadonlyArray<{ slug }>`; pass slugs, do not import server schema into the browser. `logo` and `features` are deprecated no-ops (removed after 1.0).
- Defaults you can rely on: content `/api/v1`, auth `/api/auth`, `credentials: 'include'`, mount `/admin`, sign-in `{basePath}/login`, sign-up off, `returnUrl` honoured only under the mount root.
- Host the admin with `provideRouter(routes, withComponentInputBinding())` and the official `angularLinker()` (`@forge-cms/angular/vite` or `@forge-cms/admin/vite`) on Vite/Analog; otherwise a production
  build fails with `JIT compiler unavailable`.

## Server

### 18. Auth and users

- The users collection managed by the auth adapter cannot be written through the generic content API (`403 AUTH_MANAGED_COLLECTION`, even for the trusted Local API); use `createUser`/`updateUser`/`deleteUser`/`signup`.
- Development mode is explicit (`new UsersCollectionAuthAdapter({ devMode: true })`); every other build needs `AUTH_SECRET` of at least 32 bytes.
- Sessions are an `HttpOnly` `forge_session` cookie with CSRF checks on cookie-authenticated mutations; a cross-site write is `403`. Password policy bounds and login/signup body limits (8 KiB) apply.
- A user that content references cannot be deleted (`409`); the last admin cannot be removed or demoted.
- Relations default to `onDelete: 'restrict'`; unsupported reference shapes are refused at startup.

### 19. Compatibility fixes you get for free

`0.13.1`: an `offset` without `limit` works on libSQL/D1, relation population batches under D1's parameter limit, error logs no longer echo driver messages. `0.13.2`: long `in` lists work on D1.
`0.13.3`: anonymous collection/global metadata no longer lists fields nobody can read or write (for example `passwordHash`, `_sessionVersion`; names only were exposed, never values). If you diffed metadata
output in a test, expect those two names to disappear.

## Not changing

The REST envelope (`{ data, meta }`, `{ data }`, `{ error, details? }`, `204`), the Local API method names, `defineCollection`/`defineField`, hook stages, the adapter contracts and their contract suites, and the
eleven package names are unchanged and are part of the stable surface.
