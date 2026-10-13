# @forge-cms/runtime

The ForgeCMS server runtime. `ForgeCmsRuntime` binds your collections to a database, auth and storage adapter and runs
every operation through one pipeline — access control, hooks, drafts, relation population, validation — with no HTTP
involved (the **Local API**). The same package ships the framework-agnostic **HTTP handlers** that turn a Web `Request`
into a Web `Response` for REST, auth, files, versions and globals.

**Who needs it:** every project that serves or reads content from a server. **Boundary:** server only; never
bundle it into the browser.

```sh
pnpm add @forge-cms/core @forge-cms/db @forge-cms/auth @forge-cms/storage @forge-cms/api @forge-cms/runtime
```

```ts
import { ForgeCmsRuntime } from '@forge-cms/runtime';

const runtime = new ForgeCmsRuntime({ collections, adapters: { database, auth, storage }, env });
runtime.init();
await runtime.syncSchema(); // creates tables, applies safe additive changes, refuses risky drift

const { docs } = await runtime.find({ collection: 'posts', where: { title: 'Hello' } });
```

## Stable entry points

- **Local API** (methods on `ForgeCmsRuntime`): `find`, `findOne`, `findByID`, `count`, `create`, `update`, `delete`,
  versions, globals, `preview`, `planSchema`, `syncSchema`, `runMigrations`, `reconcileStorage`. Trusted by default
  (`overrideAccess: true`); pass `overrideAccess: false` and a `user` to enforce access.
- **HTTP handlers:** `handleList`, `handleRead`, `handleCreate`, `handleUpdate`, `handleDelete`, `handleFile`,
  `handleLogin`, `handleSignup`, `handleLogout`, `handleMe`, version/preview/global handlers. The HTTP layer never trusts a
  caller-supplied `overrideAccess`.
- **Errors:** `ForgeError` subclasses (`AccessDeniedError`, `ValidationFailedError`, `NotFoundError`, …) mapped to status
  codes and the JSON error envelope; `isForgeError`.
- **Metadata:** `describeCollections` / `describeCollection` — schema metadata for clients. Anonymous metadata omits
  fields no role can read or write (for example the users collection's `passwordHash` and `_sessionVersion`; since `0.13.3`).

Full options, defaults and error codes: [docs/REFERENCE.md](../../docs/REFERENCE.md#forge-cmsruntime). Walkthroughs:
<https://forge-cms.pages.dev/docs/server-quickstart> · <https://forge-cms.pages.dev/docs/local-api> · <https://forge-cms.pages.dev/docs/rest-api>

## Compatibility

ESM only, Node >= 22 (or a Workers-compatible runtime for the Cloudflare profile). Versioned with the other public
packages — see [support](../../docs/SUPPORT.md).
