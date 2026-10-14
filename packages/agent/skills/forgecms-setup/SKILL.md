---
name: forgecms-setup
description: Set up ForgeCMS in a new or existing Angular/Analog project - choose packages and a deployment profile, create the runtime, wire the client, mount the admin and bootstrap the first admin.
---

# ForgeCMS setup

Applies to the ForgeCMS 1.0 line. Before writing code, call the `forge_project_detect` and `forge_project_doctor` MCP tools if available, and search the docs (`forge_docs_search`) instead of guessing. This skill is for the **stable** surface only.

## 1. Pick the profile first

| Profile       | Database                         | Files                           | Runtime                     |
| ------------- | -------------------------------- | ------------------------------- | --------------------------- |
| Cloudflare    | D1 (binding `DB`)                | R2 (binding `BUCKET`)           | Pages / Workers             |
| Portable Node | on-disk libSQL (`@forge-cms/db`) | S3-compatible (`@forge-cms/s3`) | Node (`node-server` preset) |

In-memory adapters (`InMemoryDatabaseAdapter`, `InMemoryStorageAdapter`) are for development and tests only; everything is lost on restart. Never ship them as the production profile.

## 2. Packages

- Server: `@forge-cms/core`, `@forge-cms/db`, `@forge-cms/auth`, `@forge-cms/storage`, `@forge-cms/runtime` (+ `@forge-cms/cloudflare` or `@forge-cms/s3`).
- Browser: `@forge-cms/angular` (typed client, `provideForgeCms`) and optionally `@forge-cms/admin`.
- Install **matching versions** of all of them - they are one fixed family.
- `@forge-cms/runtime`, `db`, `auth`, `s3`, `cloudflare`, `storage` are **server-only**: never import them from `src/app/**` (browser code).
- `@forge-cms/agent` is development tooling (`devDependencies` only) and is experimental.

Import only from package entry points (`@forge-cms/core`, `@forge-cms/angular/vite`, `@forge-cms/testing/contracts`). Never import from `src/` or `dist/`.

## 3. Runtime (server)

```ts
const database = new InMemoryDatabaseAdapter(); // development; use D1/libSQL in production
const auth = new UsersCollectionAuthAdapter().init({ ...env, userDatabase: database });
const runtime = new ForgeCmsRuntime({ collections, adapters: { database, auth, storage }, env });
runtime.init();
await runtime.syncSchema();
```

Build the runtime lazily on the first request and share it. `env.AUTH_SECRET` (at least 32 bytes of randomness) is required and is a **secret**: never commit it, never put it in `wrangler.toml [vars]`.

## 4. Angular / Analog

- Vite: use the official linker - `angularLinker()` from `@forge-cms/admin/vite` (or `@forge-cms/angular/vite`). Forge ships partial-Ivy code.
- App config: `provideRouter(routes, withComponentInputBinding())` (required by the admin) and `provideForgeCms({ baseUrl: '/api/v1', authBaseUrl: '/api/auth', credentials: 'include' })`.
- API routes live in the Analog server (`src/server/routes/api/...`) and delegate to the runtime's HTTP handlers. Keep them thin; business logic belongs in the Local API.

## 5. Admin and first user

Mount `forgeAdminAuthRoutes()` + `ForgeAdminLayoutComponent` + `forgeAdminContentRoutes()` (see the `forgecms-admin` skill). Create the first user through a bootstrap route that refuses once any user exists; the first user is an admin.

## Do not

- Do not use pre-1.0 patterns or invent options - check `REFERENCE` via docs search.
- Do not hide an in-memory fallback behind `env.DB ? D1 : InMemory`; refuse to start on an incomplete production profile.
- Do not import server packages into browser code; do not add dependencies the docs do not call for.
- Verify with the project's normal `typecheck`, `lint`, `test`, `build`.
