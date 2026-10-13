---
title: Troubleshooting
description: The real errors and symptoms ForgeCMS produces — what each name or code means and what to do — grouped by where you meet them.
group: Client & deploy
order: 6
---

Names, codes and statuses on this page are the ones in the source; the exact _message text_ is not a contract, so match on `code` / `kind` / `status`, not on prose. Still stuck? Open a
[GitHub issue](https://github.com/Andersseen/ForgeCMS/issues) with the versions of every `@forge-cms/*` package, Node, your framework and your deployment profile. A suspected vulnerability is **not** a
public issue — see [SECURITY.md](https://github.com/Andersseen/ForgeCMS/blob/main/SECURITY.md).

## Build and install

### `JIT compiler unavailable` (production only)

`@forge-cms/angular` and `@forge-cms/admin` ship Angular partial-Ivy code. In a Vite/Analog app nothing links it unless you add the official plugin, so the dev server works and the production
bundle crashes. Fix:

```ts
import { angularLinker } from '@forge-cms/angular/vite'; // or '@forge-cms/admin/vite' — the same plugin
export default defineConfig({ plugins: [angularLinker(), analog()] });
```

It needs `@angular/compiler-cli`, `@babel/core` (7 for Angular 21, 8 for Angular 22) and `vite` installed. Copying a private linker is unsupported. The Angular CLI links on its own.

### Missing or conflicting peer dependency

`pnpm` with strict peers reports the package and the range it wants. The admin needs `@angular/{cdk,common,core,forms,platform-browser,router}` `^21.2.0`, `rxjs ^7.8.0`, `@voltui/components ^1.0.1` and
`lumen-icons ^0.2.0`; the client needs `@angular/core` and `@angular/router` `^21 || ^22`. **`@angular/cdk` is required since `0.12.1`.** The admin on Angular 22 is not supported (VoltUI 1.x peers Angular 21).
Two copies of `@angular/common`/`core` in the install (check with `pnpm why @angular/core`) break the router at runtime — dedupe to one. Ranges and tested versions: [SUPPORT.md](https://github.com/Andersseen/ForgeCMS/blob/main/docs/SUPPORT.md).

### Imports that cannot resolve

Import `@forge-cms/*` only through entry points: `@forge-cms/angular/server`, `/vite`, `@forge-cms/admin/vite` and `@forge-cms/testing/contracts` are the only subpaths. Relative imports in your own ESM TypeScript need the
`.js` extension under `NodeNext`. Never import `@forge-cms/runtime`, `db`, `auth`, `s3` or `cloudflare` from browser code.

## Server startup and schema

### `SchemaDriftError` (`code: 'SCHEMA_DRIFT'`)

`syncSchema()` found a change it will not apply automatically (a removed field, a changed type, `localized` toggled, a new required field on a table with rows, `unique` over duplicates…) and executed
**nothing**. `error.plan` lists every change and what to do; `runtime.planSchema()` prints the same plan read-only. Apply it with a reviewed migration — [Schema upgrades](/docs/schema-upgrades) — or revert the definition. Renames are never guessed.

### `MigrationError`

Check `error.code` and `error.phase`:

| Code                          | Meaning / fix                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `MIGRATION_INVALID`           | The definition is malformed (id, statements). Fix the migration before running                                     |
| `MIGRATION_UNSUPPORTED`       | The database adapter cannot run migrations (the in-memory adapter)                                                 |
| `MIGRATION_CHECKSUM_MISMATCH` | An already-applied migration was edited. Never edit one; add a new migration                                       |
| `MIGRATION_HISTORY_MISMATCH`  | The list you passed is not the recorded history in order (a migration removed, reordered or inserted). Append only |
| `MIGRATION_REVIEW_REQUIRED`   | A destructive migration without `allowDestructive: true` — back up first, then opt in                              |
| `MIGRATION_RETRY_REQUIRED`    | A recorded failure exists; approve with `retryFailed` or `replaceFailed` after fixing                              |
| `MIGRATION_EXECUTION_FAILED`  | The SQL failed; the migration did not commit. Fix and retry                                                        |
| `MIGRATION_OUTCOME_UNKNOWN`   | The outcome is unknown (connection lost). Inspect the ledger before retrying                                       |
| `MIGRATION_POSTFLIGHT_FAILED` | The migrations committed but a blocking schema change remains (`error.plan`)                                       |

Migrations run from a deploy script, never at startup. There are no down migrations: forward-fix or restore a backup.

### Invalid or incomplete production profile

A production build must use exactly one complete durable profile and refuse to start otherwise. The reference factory (`apps/tiny-project/src/server/api/profile.ts`) throws
`Incomplete Cloudflare profile: missing …` (it needs the D1 binding `DB` **and** the R2 binding `BUCKET`), `Incomplete portable profile: missing …` (`DATABASE_URL` plus `S3_BUCKET` and `S3_REGION`),
`Ambiguous deployment profile` (both sets present) or `No durable deployment profile is configured`. These messages come from _your app's_ factory — ForgeCMS accepts any adapter combination — so if you
see none of them and data disappears on restart, your selector probably falls back to in-memory. A renamed binding (`env.DB` is `undefined`) is the usual cause; pass `new D1DatabaseAdapter({ binding })`.

### Data disappears after a restart or deploy

- An `InMemory…` adapter is in use (development only).
- A libSQL **`file:` database on an ephemeral filesystem** (a container without a volume, a serverless disk): the file is recreated empty on each start. Put it on a persistent volume or use a `libsql://` URL.
- `AUTH_SECRET` changed: existing sessions stop validating (users must sign in again; data is intact).

### Auth secret errors at startup

A non-development build without `AUTH_SECRET` (at least 32 bytes) refuses to start rather than signing sessions with Forge's public dev secret. `devMode: true` is an explicit local-development opt-in; never derive it from a missing secret.

## HTTP, auth and sessions

### `401` versus `403`

| Status | Code           | Meaning                                                                                                                                                            |
| ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `401`  | `UNAUTHORIZED` | No, an invalid or an expired session/token. Sign in again                                                                                                          |
| `403`  | `FORBIDDEN`    | Authenticated but not allowed (a role or access rule), **or** a cross-site cookie mutation (CSRF), or an auth-managed collection write (`AUTH_MANAGED_COLLECTION`) |

The client's `ForgeAuthSession` turns a `401` on any request while signed in into `status() === 'anonymous'` with `expired() === true`; a `403` never does. Tokens last 24 hours, and a password change
invalidates every earlier session. An anonymous `GET /api/auth/me` is an expected `401` (it shows as a failed request in the browser console).

### CSRF failure (`403 FORBIDDEN` on a write)

Cookie-authenticated `POST`/`PUT`/`PATCH`/`DELETE` must come from the same origin: the `Origin` (or `Referer`) must match the server. A cross-origin page, a server-side script sending the cookie without an
`Origin`, or a proxy that rewrites the host triggers it. Same-origin browser calls pass. Machine clients should use `Authorization: Bearer` (API keys), which is not subject to the check. Protection is never disabled.

### `413 PAYLOAD_TOO_LARGE`

The login/signup JSON body is bounded (8 KiB by default; `maxBodyBytes` up to 1 MiB, raise it only together with `passwordPolicy.maxLength`). It is also what your platform (Workers request-body limit, reverse proxy)
returns for a very large upload before Forge sees it — raise that limit at the platform.

### Upload rejected (size or MIME type)

Forge has **no default size cap**. When you configure `upload: { maxFileSize, mimeTypes }` on the create handler, a file over the size or outside the allowed MIME list is `400 INVALID_INPUT` with a message naming the limit
(not 413). A missing `file` part is also `400`: the multipart part must be named `file`.

### Validation errors (`400 VALIDATION_ERROR`)

The body is `{ "error": …, "details": [{ "field": "title", "message": "title is required", "code": "required" }] }`. Codes are `required` or `type_<kind>`; nested fields use dotted paths (`seo.metaTitle`,
`steps.1.label`). Through the Local API the same list is on `ValidationFailedError.details`; in the Angular client it is `ApiValidationError`/`ForgeApiError.details`. Other 400s: `INVALID_INPUT`, `INVALID_QUERY`
and `UNKNOWN_FIELD` (a `where`/`sort` names a field the collection does not have). `409`: `UNIQUE_CONSTRAINT`, `CONCURRENT_MODIFICATION`. `429 RATE_LIMITED`: your own throttle.

### `ForgeApiError` in Angular

Every client failure is a `ForgeApiError` with `kind`, `status`, `code` and `details`: `http` (a non-2xx answer; `status` set), `network` (no answer: offline, DNS, refused, CORS — `status` undefined), `aborted` (your
`AbortSignal`), `invalid-response` (a 2xx that is not the Forge envelope — often an HTML page from a proxy or the wrong `baseUrl`). Use `isForgeApiError(error)`. An absolute `baseUrl` on another origin needs
`trustedOrigins` for cookies/Bearer and CORS with credentials on the server.

### `SERVER_ORIGIN_REQUIRED` (during SSR)

`ForgeApiError({ kind: 'network', code: 'SERVER_ORIGIN_REQUIRED' })`: a server render made a relative request and no server origin was provided. Provide `provideForgeCmsServer({ origin })` per render in
`main.server.ts`, with an absolute `http(s)` origin from explicit configuration (for example `FORGE_SSR_ORIGIN`) — never the incoming `Host`. An invalid origin throws a `TypeError` naming it. See [Server rendering](/docs/ssr).

## Admin

### Custom mount and `returnUrl` mistakes

Mounting the admin at `/studio`? Set **the same root** in three places and nowhere else: `ForgeAdminConfig.basePath` (layout `data.config`), `forgeAdminAuthRoutes({ basePath })`, and the guard's
`signInPath`/`forbiddenPath`. The API bases come only from `provideForgeCms()`. Symptoms: sign-in lands on `/admin` (basePath missing on the layout), the guard redirects to a page that does not exist
(`signInPath` left at the default), or a `returnUrl` is ignored — it is honoured **only under the mount root** (external, `//`, `javascript:` and sibling-prefix targets such as `/studio-evil` are refused by design).
`basePath` must be an absolute same-app path; an invalid one throws from `forgeAdminAuthRoutes`.

### The admin renders empty or inputs are `undefined`

The router lacks `withComponentInputBinding()`; the admin reads its route data through inputs. Also check that the collections metadata route (`GET /api/v1/collections`) is mounted and returns `{ data }`.

### A saved edit "vanished" or a `401` banner appears while editing

A `401` leaves the form on screen with a "session expired" notice and blocks further saves until sign-in; nothing is lost. A `409` means the document or a referenced document changed — reload and retry.

## Files and storage

### Uploaded file returns `404`

`handleFile` serves a key only as the file of the document whose `_storageKey` is that key, and only if the caller can read that document (collection and row access, draft visibility). A `404` therefore means:
no route is mounted at the storage adapter's public URL (`/api/media` by default); the document is not readable by this caller; the document is a pre-`_storageKey` record with no owner (backfill `_storageKey`);
or the object really is missing in the bucket (a deleted or never-stored object — run `runtime.reconcileStorage()` and compare with a backup).

### S3 / R2 access failure (`500`)

An unreachable bucket, rejected credentials or a missing bucket surface as a **generic `500`** that deliberately names no bucket, endpoint or key. Look at server logs (they log the error class, not secrets).
S3: the bucket must already exist; `region` is required; most S3-compatible services need `forcePathStyle: true`; `endpoint` must be `https://` outside local development; omit `credentials` only if the SDK's provider
chain can resolve them. R2: both bindings must exist and match the names the adapter looks for (`BUCKET` by default). Only Garage `v2.4.1` is certified; on AWS, B2 or Wasabi verify an upload/read/delete yourself.

### Orphaned objects or documents

A crash between the database and the object store can leave a storage intent behind. Schedule `runtime.reconcileStorage()` (safe to repeat and to run concurrently); it never deletes an object a document owns.

## Deployment and operations

- **Health checks and what to look at after a deploy:** [DEPLOYMENT-HEALTH.md](https://github.com/Andersseen/ForgeCMS/blob/main/docs/DEPLOYMENT-HEALTH.md). **Rehearsal and recovery:** [STAGING-REHEARSAL.md](https://github.com/Andersseen/ForgeCMS/blob/main/docs/STAGING-REHEARSAL.md), [BACKUP-RESTORE.md](https://github.com/Andersseen/ForgeCMS/blob/main/docs/BACKUP-RESTORE.md).
- **Cloudflare Pages deploy used the wrong configuration:** run Wrangler from the generated app directory, not through `pnpm --dir` at a repository root that has its own `wrangler.toml`.
- **D1 query fails with "too many SQL variables":** fixed in `0.13.2` (long `in` lists); upgrade.
- **Anonymous metadata lists `passwordHash`/`_sessionVersion` (field names):** fixed in `0.13.3`; upgrade.
