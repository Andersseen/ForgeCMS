<div align="center">

<img src="./.github/assets/banner.svg" alt="ForgeCMS — code-first, TypeScript-native CMS foundation" width="100%" />

<br />

**Code-first, TypeScript-native CMS foundation with first-class Angular, Analog, and Cloudflare support.**

<br />

[![CI](https://img.shields.io/github/actions/workflow/status/Andersseen/ForgeCMS/ci.yml?branch=main&label=CI&style=flat-square&logo=githubactions&logoColor=white)](https://github.com/Andersseen/ForgeCMS/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-8B5CF6.svg?style=flat-square)](./LICENSE)
[![Status](https://img.shields.io/badge/status-experimental-22D3EE.svg?style=flat-square)](docs/STATE.md)

**[Quick start](docs/QUICKSTART.md)** · **[Architecture](docs/ARCHITECTURE.md)** · **[Roadmap](docs/ROADMAP.md)** · **[Status](docs/STATE.md)**

</div>

---

> [!WARNING]
> ForgeCMS `0.4.x` is pre-1.0. The fundamentals — schema DSL, Local API, HTTP handlers, access
> control, hooks, drafts, versions, globals, live preview, localization, relations, and a reusable
> Angular admin — are usable and exercised by real consumer apps in this repo, but API stability is
> not guaranteed before `1.0`. See [docs/STATE.md](docs/STATE.md) for exactly what is implemented and
> [docs/ROADMAP.md](docs/ROADMAP.md) for what remains before `1.0`.

## What Is ForgeCMS?

ForgeCMS is a generic CMS foundation for TypeScript applications. You define collections in code,
create a runtime, choose adapters for database/auth/storage, and expose either the Local API or the
framework-agnostic HTTP handlers from your own server.

It is not tied to Analog. The current repository includes Analog apps and Angular packages because
Angular/Analog and Cloudflare are first-class targets, but the core/runtime packages stay framework
agnostic.

## Install

```sh
pnpm add @forge-cms/core @forge-cms/runtime @forge-cms/db @forge-cms/auth @forge-cms/storage
```

Optional integrations:

```sh
pnpm add @forge-cms/cloudflare   # D1 and R2 adapters
pnpm add @forge-cms/angular      # Angular client SDK
pnpm add @forge-cms/admin        # Angular admin components
```

## Minimal Runtime

```ts
import { defineCollection, defineField } from '@forge-cms/core';
import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

const notes = defineCollection({
  slug: 'notes',
  fields: {
    title: defineField.text({ required: true }),
    data: defineField.json()
  }
});

const runtime = new ForgeCmsRuntime({
  collections: [notes],
  adapters: {
    database: new InMemoryDatabaseAdapter(),
    auth: new InMemoryAuthAdapter(),
    storage: new InMemoryStorageAdapter()
  }
});

runtime.init();
await runtime.syncSchema();

const created = await runtime.create({
  collection: 'notes',
  data: { title: 'Hello ForgeCMS', data: { source: 'readme' } }
});

const { docs } = await runtime.find({ collection: 'notes' });
```

See [docs/QUICKSTART.md](docs/QUICKSTART.md) for HTTP handler setup, Cloudflare notes, and Angular
usage.

## What ForgeCMS `0.4.x` Delivers Today

Verified from packed npm artifacts (`pnpm release:verify`) and real consumer apps in this repo
(`apps/tiny-project`, `apps/demo-aesthetics`, `apps/www`):

- schema definitions with `defineCollection`/`defineField`, including composite fields (group,
  array, blocks) and relations (with `depth: 1` population)
- collection CRUD, `findOne`, nested `and`/`or` queries, and multi-field sort through the Local API
- framework-agnostic HTTP handlers with a stable response envelope
- runtime validation, the full hook pipeline, and function-based row/field-level access control
- drafts, document versions with restore, live preview, globals, and localization — all enforcing
  the same access/draft/field policy as ordinary reads and writes
- relation integrity (`restrict`/`cascade`/`set-null` on delete), including self-relations
- browser auth (signup/signin/logout/session cookies, CSRF) and machine auth (scoped API keys)
- in-memory, LibSQL, and Cloudflare D1 database adapters (shared contract test suite); R2 storage
- a reusable Angular admin (`@forge-cms/admin`) covering content, users, and auth, embeddable under a
  host app's own routes — not a skeleton, and not a redesign target
- adapter contract tests through `@forge-cms/testing/contracts`

Not yet delivered pre-1.0: a portable (non-Cloudflare) storage adapter, production SSR for the
Angular/Analog client, and a documented schema-upgrade path — see
[docs/ROADMAP.md](docs/ROADMAP.md).

## Packages

All public packages are versioned together.

| Package                                        | Version | Purpose                                                             |
| ---------------------------------------------- | :-----: | ------------------------------------------------------------------- |
| [`@forge-cms/core`](packages/core)             |  0.4.x  | Schema DSL, collection/global definitions, validation, base types   |
| [`@forge-cms/db`](packages/db)                 |  0.4.x  | Database contract, InMemory and LibSQL adapters, SQL schema helpers |
| [`@forge-cms/auth`](packages/auth)             |  0.4.x  | Auth contract and built-in auth adapters                            |
| [`@forge-cms/storage`](packages/storage)       |  0.4.x  | Storage contract and InMemory adapter                               |
| [`@forge-cms/api`](packages/api)               |  0.4.x  | `ApiContext` and HTTP handler contracts                             |
| [`@forge-cms/runtime`](packages/runtime)       |  0.4.x  | Runtime orchestrator, Local API, HTTP handlers                      |
| [`@forge-cms/cloudflare`](packages/cloudflare) |  0.4.x  | Cloudflare D1 and R2 adapters                                       |
| [`@forge-cms/angular`](packages/angular)       |  0.4.x  | Angular client SDK                                                  |
| [`@forge-cms/admin`](packages/admin)           |  0.4.x  | Reusable Angular admin components (content, users, auth)            |
| [`@forge-cms/testing`](packages/testing)       |  0.4.x  | Adapter contract test suites                                        |

Exact patch versions move independently as changesets land; see each package's `package.json` or npm
for the currently published version.

## Schema Synchronization

`runtime.syncSchema()` is additive. Built-in SQLite-style adapters create missing tables and add
missing columns, but they do not drop columns, rename columns, change column types, or backfill data.
Treat it as a convenient early schema sync tool, not as a complete migration system.

## Developing This Repository

```sh
git clone https://github.com/Andersseen/ForgeCMS.git
cd ForgeCMS
pnpm install
pnpm build
pnpm dev:www
```

Common commands:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:cloudflare   # real local D1/R2 via Miniflare — no account or credentials needed
pnpm test:libsql       # real libSQL database, no Cloudflare binding at all
pnpm release:verify
pnpm e2e:www
pnpm e2e:tiny-project
pnpm e2e:demo
```

Before release, `pnpm release:verify` packs every public package and installs those tarballs into
isolated external consumer projects. This is the publish gate that catches workspace-only mistakes.

## Contributing

Non-trivial changes start with a spec in [docs/specs](docs/specs). See [CLAUDE.md](CLAUDE.md),
[docs/SDD.md](docs/SDD.md), and [CONTRIBUTING.md](CONTRIBUTING.md). Changes under `packages/*`
require a changeset after the first public baseline.

## License

[MIT](./LICENSE) © ForgeCMS contributors
