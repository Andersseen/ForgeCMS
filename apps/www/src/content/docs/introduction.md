---
title: Introduction
description: What ForgeCMS is, what it already does, and what it does not do yet.
group: Getting started
order: 1
---

ForgeCMS is a **code-first, TypeScript-native CMS foundation** with first-class Angular, Analog.js
and Cloudflare support.

You describe your content in TypeScript:

```ts
import { defineCollection, defineField } from '@forge-cms/core';

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({ autoGenerate: true, sourceField: 'title' }),
    body: defineField.richtext(),
    cover: defineField.upload({ collection: 'media' }),
    author: defineField.relation({ collection: 'users' })
  }
});
```

…and that one definition drives the database schema, runtime validation, the REST API, the admin UI
form, and the types you get back in your Angular app. There is no schema file to keep in sync and no
code generation step.

## Why it exists

Every serious headless CMS in this space assumes React. Payload, Strapi and Sanity all ship React
admin panels and React-shaped client libraries; using them from Angular means running someone else's
framework beside yours, or hand-writing a client for a REST API you did not design.

ForgeCMS starts from the other end: Angular signals, Analog.js server routes, an admin panel that is
Angular components you can import, and a **Local API you call directly from server code** — no HTTP
hop between your Analog route and your content.

## What is real today

- **Schema DSL and validation** — 15 field kinds including `group`, `array` and `blocks` (the
  page-builder primitive), validated at runtime on every write.
- **A Local API** — `find`, `findByID`, `create`, `update`, `delete`, `count` on the runtime object,
  running the full pipeline (access control, hooks, drafts, relation population, validation).
- **A REST API** — CRUD with filtering, sorting, pagination, relation population and draft
  visibility, in a stable envelope.
- **Access control as functions** — a rule can return `true`/`false` or a **query** that narrows
  which documents the operation may touch (row-level rules like "authors edit only their own posts").
- **A full hook pipeline** — nine collection stages plus per-field hooks.
- **Real auth** — users stored in your database with PBKDF2 hashing, signed tokens, and
  admin/editor/viewer roles.
- **Uploads** — `multipart/form-data` creates through a `StorageAdapter`, with a file-serving handler.
- **Adapters** — in-memory, LibSQL/Turso and Cloudflare D1 for the database; in-memory and R2 for
  storage; all held to a shared contract test suite.
- **An Angular client and admin UI** — `CmsApiService` plus signal-based resources, and importable
  admin components (list, schema-driven form, relation/upload/richtext pickers).

## What is experimental

Be honest with yourself about this list before adopting it for something that matters:

- **Pre-1.0 release line.** `0.4.x` is installable and smoke-tested through a small-project
  consumer, but API stability is not guaranteed before `1.0`.
- **Schema sync is additive.** It creates tables and adds columns, but it does not drop, rename,
  retype, or backfill data.
- **Query gaps** — one sort field, no `OR`, no querying inside composite JSON values, and relation
  population is one level deep (`depth: 1`).
- **No SSR-safe client fetch.** The Angular client is browser-first; a content site that needs SSR
  has to call the Local API from a server route instead (which is the better pattern anyway).
- **No email adapter, plugin system, or CLI.**

## How the pieces fit

```txt
Your Angular app  ──►  @forge-cms/angular  ──►  HTTP /api/v1/*  ──┐
                                                                  ├─►  @forge-cms/runtime  ──►  adapters (db / auth / storage)
Your server route ──►  runtime.find(...)  (Local API, no HTTP)  ──┘
```

`@forge-cms/core` defines the schema, `@forge-cms/runtime` executes operations, and the adapter
packages talk to the outside world. Read [Core concepts](/docs/concepts) for the full picture.

## Where to go next

- [Small project guide](/docs/small-project-guide) — users, cookie auth, posts, and a working admin.
- [Quickstart](/docs/quickstart) — the bare Local API path in about ten minutes.
- [Core concepts](/docs/concepts) — the mental model, in one page.
- [Collections](/docs/collections) and [Fields](/docs/fields) — the modelling reference.
- [Local API](/docs/local-api) — the way to use ForgeCMS from server code.

The repository also keeps a maintainer-facing record: `docs/STATE.md` (what is implemented, package
by package), `docs/ARCHITECTURE.md`, and `docs/specs/` (one spec per feature, with the reasoning
behind it).
