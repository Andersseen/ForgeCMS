# ROADMAP — From typed CRUD to a real CMS for Angular / Analog.js

> **Last updated: 2026-07-22.**
>
> **What this file is:** the multi-phase plan that takes ForgeCMS from "a well-engineered typed CRUD
> over SQLite with an admin table" to a CMS a real team would run in production. It is deliberately
> _coarser_ than `docs/specs/*` — each numbered item below becomes its own spec when it is picked up.
>
> **Relationship to other docs:** [STATE.md](STATE.md) is what exists **today** (trust it over this
> file). This file is what should exist **next, and in what order**. When an item ships, mark it here
> and move the detail into STATE.md. Per [SDD.md](SDD.md), non-trivial items still need a spec.

## The thesis

Payload is the reference point, not the target. Chasing feature parity with Payload is a losing
game — they have a multi-year head start and a full-time team. **The thing ForgeCMS can be that
Payload cannot is a CMS whose native consumption model is Angular and Analog.js.**

Concretely, that means the win condition is not "we also have blocks". It is:

```ts
// apps/site/src/server/routes/blog.server.ts — an Analog server route
import { getServerRuntime } from '../api/runtime';

export default defineEventHandler(async (event) => {
  const cms = await getServerRuntime(event.context.cloudflare?.env);
  return cms.find({ collection: 'posts', where: { _status: 'published' }, depth: 1 });
});
```

...with no HTTP hop, no fabricated `Request`, full type inference from the collection definition, and
a signals-based client for the browser half. That is the moat. Everything else in this roadmap is
either **table stakes** (you cannot call yourself a CMS without it) or **table dressing** (nice, but
it never wins a user).

Ordering principle throughout: **cost-of-delay, not visibility.** Items that change the shape of
stored data or the shape of the core pipeline come first, because every feature built on top of the
old shape has to be rewritten.

---

## Phase 0 — Unblock

_Small, mechanical, removes things that make the project unusable or untrustworthy._

| #   | Item                                                                                                        | Why now                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 0.1 | **Fix D1 `users.passwordHash`**                                                                             | Auth is broken on the only production path. `STATE.md` known issue #10, last bullet.              |
| 0.2 | **`count(where)` + real pagination meta** (`totalDocs`, `totalPages`, `page`, `hasNextPage`, `hasPrevPage`) | `meta.count` is currently the page length, so no client can build a paginator. Blocks Phase 4.30. |
| 0.3 | **Publish `0.1.0` to npm**                                                                                  | A CMS nobody can `pnpm add` does not exist. Needs registry credentials — a human step.            |

---

## Phase 1 — The structural core

_This is the phase that decides whether ForgeCMS is a CMS. Do these in order: each one makes the next
cheaper, and doing them out of order means rewriting._

### 019 — Local API

Move every operation (validation, hooks, access, drafts, populate, pagination) out of the HTTP
handlers and onto `ForgeCmsRuntime` as `find` / `findByID` / `create` / `update` / `delete` / `count`.
The `handleX` functions become thin: parse `Request` → call the local API → map typed errors to
status codes → wrap in the envelope.

**Why first:** it is the moat (see thesis), _and_ it makes 020/021/022 testable without inventing a
`Request` object for every test case. Doing it after those three means porting them.

### 020 — Access control as functions

`access.read` etc. become `string[] | (args) => boolean | Where`. The returned `Where` is AND-merged
into the query, which is what makes row-level rules — "an author may only edit their own posts",
per-tenant isolation, per-team drafts — expressible at all. `string[]` stays as backward-compatible
sugar. Field-level access gets the same treatment.

**Why here:** it changes the query pipeline. Every read path built before it has to be re-plumbed.

### 021 — Full hook pipeline

`beforeOperation`, `beforeValidate`, `beforeChange`, `afterChange`, `beforeRead`, `afterRead`,
`beforeDelete`, `afterDelete`, `afterOperation`, plus **field-level** hooks. Today only
`beforeChange`/`afterChange` exist, so there is no way to derive a value on read, cascade on delete,
or normalise before validation.

**Why here:** nearly free once 019 exists (one pipeline, one place); expensive while the logic is
smeared across five HTTP handlers.

### 022 — Composite fields: `group`, `array`, `blocks`

The big one. `FieldMap` is currently `Record<string, AnyField>` where every field is a flat scalar,
and the storage model is one flat column per field. Composite fields require recursive types,
recursive validation, recursive form rendering, and a nested storage strategy (**JSON column** — the
pragmatic, edge-friendly choice; join tables are a later optimisation, not a v1 requirement).

**Why it matters:** `blocks` is the entire reason page-builder-shaped CMSs get chosen. Without it
ForgeCMS competes with Directus, not with Payload.

**Why last in the phase:** it is the largest change, and 019/020/021 make it safer to land.

---

## Phase 2 — A complete content model

| #   | Item                                                                                               | Notes                                                                                           |
| --- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 023 | **Globals** (singleton documents: nav, footer, site settings)                                      | Cheap, high return. `apps/www` already fakes one with a `site_config` collection.               |
| 024 | **Versions & revisions** — history, diff, restore, autosave, scheduled publish                     | Spec 017 shipped `_status`, which is ~15% of versioning. Editors touching production need undo. |
| 025 | **Localisation** — `localized: true`, `?locale=`, fallback chain                                   | Changes the storage shape. **Doing this after real data exists is materially more expensive.**  |
| 026 | **Query completeness** — nested `and`/`or`, multi-field sort, `like`                               | Today `where` is flat AND-only with single-field sort.                                          |
| 027 | **Referential integrity** — cascade / restrict on delete, polymorphic relations (`relationTo: []`) | Deleting an author currently leaves posts pointing at a dead id.                                |

---

## Phase 3 — Auth and DX as a product

| #   | Item                                                                                                                                                               | Notes                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 028 | **Real auth** — `auth: true` on any collection (not a hardcoded `users`), httpOnly cookie sessions, refresh, password reset, email verification, API keys, lockout | Today: a bearer token and nothing else. `AuthAdapter` does not even have `login` in its contract. |
| 029 | **Email adapter** (`@forge-cms/email`) — contract + Resend / MailChannels for the Cloudflare target                                                                | Hard prerequisite for 028's password reset.                                                       |
| 030 | **Config + plugin system** — `buildForgeConfig({ collections, globals, admin, plugins })`, plugins as `(config) => config`                                         | No plugin API means no ecosystem, ever.                                                           |
| 031 | **CLI** (`@forge-cms/cli`) — `create-forge-cms`, `forge migrate` (versioned, with `down`), `forge generate:types`                                                  | Spec 014 is additive-only sync: no history, no rollback.                                          |

---

## Phase 4 — An admin a non-developer can use

| #   | Item                                                                                                   | Notes                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 032 | **Field widgets** — real richtext editor, media picker with previews, **relation picker with search**  | The relation field is currently a text input where you paste a UUID by hand. Specs 015/016 shipped kinds with no editor. |
| 033 | **List view** — pagination controls, clickable sort, configurable columns, saved filters, bulk actions | Depends on 0.2.                                                                                                          |
| 034 | **Conditional fields** (`admin.condition`), sidebar placement, custom component API                    |                                                                                                                          |
| 035 | **Live preview + a real dashboard**                                                                    |                                                                                                                          |

---

## Phase 5 — The Angular/Analog moat, finished

| #   | Item                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 036 | **Signals-based client** — `resource()`-backed collection/document resources in `@forge-cms/angular`, SSR-safe fetch + hydration transfer |
| 037 | **Analog integration package** — file-route helpers, typed server-route factories, `@forge-cms/analog`                                    |
| 038 | **Generated types from collections** to the client without a codegen step (extend the existing `CollectionData<T>` inference)             |

> Items 036–038 are listed last only because they depend on 019 having landed. In terms of _strategic
> value they rank immediately after Phase 1_ — ahead of most of Phases 2–4. If time is short, prefer
> them over feature parity work.

---

## Explicit non-goals (for now)

- **GraphQL.** REST + a typed Local API covers the Angular story. Revisit only on real demand.
- **Jobs / queues.** Cloudflare Queues can be bolted on later; not a CMS core concern.
- **Multi-tenancy as a first-class feature.** Once 020 lands, a `Where`-returning access function
  already expresses tenant isolation. Do not build a subsystem for it.
- **Join-table storage for composite fields.** JSON columns first (022). Revisit if querying _inside_
  arrays/blocks becomes a real requirement.

---

## Progress

| Phase                     | Status                                                            |
| ------------------------- | ----------------------------------------------------------------- |
| Phase 0 — Unblock         | ✅ 0.1, 0.2 done 2026-07-22 · 0.3 pending (needs npm credentials) |
| Phase 1 — Structural core | ✅ 019, 020, 021, 022 done 2026-07-22                             |
| Phase 2 — Content model   | ⬜ not started                                                    |
| Phase 3 — Auth & DX       | ⬜ not started                                                    |
| Phase 4 — Admin UI        | ⬜ not started                                                    |
| Phase 5 — Angular moat    | ⬜ not started                                                    |
