# 039 — Build a real-world demo app (aesthetics clinic) on top of ForgeCMS

- **Status:** in-progress
- **Author:** agent draft (requested by the maintainer)
- **Date:** 2026-07-27
- **Branch:** `feature/demo-aesthetics-app`
- **Affected packages/apps:** new `apps/demo-aesthetics` (consumes `@forge-cms/core`, `db`, `auth`,
  `storage`, `runtime`, `cloudflare`, `angular`, `admin`). No package source changes.

> **Numbering note:** spec numbers 023–038 are reserved by the numbered items in
> [ROADMAP.md](../ROADMAP.md). This spec is not a roadmap item, so it takes the next free number
> above them.

## Context / Why

Every collection in `apps/www`'s server runtime exists to show a _feature of the CMS_: `landing_pages`
demonstrates composite fields, `site_config` fakes a global, `products` demonstrates relations. None
of it is a content model somebody would actually run a business on, and no page in `apps/www` renders
CMS content to an end user — the only consumer is the admin UI, which is generic by construction.

The result is that the project has never answered the question "what breaks when you build a real
site with this?". Phase 1 of the roadmap is done and Phases 2–5 are sequenced by _assumed_
cost-of-delay. A real build is the cheapest way to test those assumptions before spending weeks on
them.

## Goal

A second, self-contained Analog.js app — a marketing site for a fictional aesthetics clinic — whose
**every** piece of content comes from ForgeCMS, plus a written record (`docs/DEMO-FINDINGS.md`) of
each gap the build hit, mapped to a roadmap item.

## Non-goals

- **Changing any package.** If the demo hits a CMS limitation, it works around it _in the app_ and
  the workaround is documented as a finding. This keeps the PR reviewable and keeps the findings
  honest — a gap papered over in `packages/*` is a gap nobody remembers.
- **Deploying.** CI's deploy job stays pointed at `apps/www` only.
- **SSR.** `apps/www` runs `ssr: false` and so does this app (same Angular-linker constraints). The
  fact that a marketing site really wants SSR is itself a finding, not a task here.
- **E2E tests.** Per CONVENTIONS.md, Playwright stays in `apps/www`. This app ships Vitest coverage
  of its content model instead.
- **A design system of its own.** UI is Tailwind 4 + `@voltui/components`, as in `apps/www`.

## Design

### App layout

```
apps/demo-aesthetics/
  src/server/api/collections.ts   the content model (11 collections)
  src/server/api/seed.ts          realistic seed content
  src/server/api/runtime.ts       getServerRuntime(env) — adapters, init, syncSchema, seed
  src/server/routes/api/v1/*      generic CRUD, delegating to @forge-cms/runtime handlers
  src/server/routes/api/auth/*    login / me / users
  src/server/routes/api/site/*    purpose-built endpoints built on the Local API
  src/app/pages/site/*            the public marketing site
  src/app/pages/admin/*           the editor UI, on @forge-cms/admin
```

### Content model (`src/server/api/collections.ts`)

| Collection           | Why it is in the demo                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `service_categories` | Plain reference data; parent of `services`.                                                           |
| `services`           | `drafts: true`, composite `array` (benefits, faqs) + `group` (aftercare), field hook deriving `slug`. |
| `staff`              | `relation … many` to services, `group` for socials, `upload` for the photo.                           |
| `testimonials`       | `drafts: true`, moderation flow.                                                                      |
| `bookings`           | The access-control case: **public create, row-level read.**                                           |
| `promotions`         | Row-level read (`active` only for anonymous callers).                                                 |
| `posts`              | `richtext` body + `upload` cover + derived reading time (field hook).                                 |
| `media`              | `upload: true` — the multipart flow from spec 016.                                                    |
| `pages`              | `blocks` — the home page is composed from CMS blocks.                                                 |
| `site_settings`      | The global that ForgeCMS does not have (roadmap 023).                                                 |
| `users`              | `withAuthFields(...)`, as in `apps/www`.                                                              |

`bookings` is the spec-020 showcase and the security-relevant one:

```ts
access: {
  create: () => true,                      // a visitor may request an appointment
  read: ({ user }) =>                      // staff see everything; a client sees only their own
    user ? (isStaff(user) ? true : { email: { eq: user.email } }) : false,
  update: ['admin', 'editor'],
  delete: ['admin']
}
```

with a `beforeChange` hook that force-resets `status` to `pending` on any anonymous create, so a
public POST cannot self-confirm a booking.

### Public endpoints (`src/server/routes/api/site/*`)

These are the point of the app: **no HTTP hop between the site and the CMS.** Each handler calls the
Local API directly, composes several collections into one payload, and returns exactly the shape one
page needs.

| Route                          | Local API calls                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `GET /api/site/home`           | `pages` (blocks) + featured `services` + `testimonials` + `promotions` + settings, in parallel |
| `GET /api/site/services`       | `services` (+ categories, `depth: 1`)                                                          |
| `GET /api/site/services/:slug` | one service by slug + related staff                                                            |
| `GET /api/site/team`           | `staff`, `depth: 1`                                                                            |
| `GET /api/site/journal`        | `posts`                                                                                        |
| `GET /api/site/journal/:slug`  | one post by slug                                                                               |
| `GET /api/site/settings`       | `site_settings`                                                                                |
| `POST /api/site/bookings`      | `create` with `overrideAccess: false, user: null` — public write, access rule decides          |

Every one passes `overrideAccess: false` and `user: null`, so the public site runs through the same
access/draft rules an anonymous HTTP caller would, rather than trusting itself.

### Client

`SiteApiService` (`src/app/services/site-api.service.ts`) wraps `/api/site` with hand-written
response interfaces. `CmsApiService` from `@forge-cms/angular` is used only by `/admin` and `/login`.

## Implementation plan

- [x] Spec (this file)
- [x] Scaffold the app: `package.json`, `vite.config.ts` (+ the Angular linker plugin), tsconfigs,
      `index.html`, `styles.css`, bootstrap, routes
- [x] Content model + seed + `getServerRuntime`
- [x] Server routes: v1 CRUD, auth, `/api/site/*`
- [x] Public site pages + shell (header/footer) + `SiteApiService`
- [x] Admin pages on `@forge-cms/admin`
- [x] Vitest coverage of the content model through the Local API
- [x] `docs/DEMO-FINDINGS.md`, README, root scripts, STATE.md / ROADMAP.md updates

## Test plan

- `apps/demo-aesthetics/src/server/api/collections.test.ts` — drives a real in-memory runtime:
  drafts hidden from anonymous reads, public booking create allowed, anonymous booking read denied,
  client sees only their own bookings, anonymous create cannot set `status`, slug/reading-time field
  hooks fire, promotions filtered to `active` for anonymous callers.
- `pnpm --filter @forge-cms/demo-aesthetics test` green.
- Manual: `pnpm dev:demo` → `/` renders CMS-driven blocks, `/services` and a detail page render,
  `/booking` creates a booking that shows up under `/admin/collections/bookings` after logging in.
- Full gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Acceptance criteria

1. `pnpm dev:demo` serves a marketing site whose content all comes from the CMS (no hardcoded copy
   in components beyond labels/chrome).
2. The home page is rendered from a `blocks` field, not a fixed template.
3. A booking can be created by an unauthenticated visitor and is only readable by staff.
4. `/admin` manages every collection through `@forge-cms/admin`'s real components.
5. No file under `packages/*` changes in this PR.
6. `docs/DEMO-FINDINGS.md` lists each gap hit, with the app-side workaround and the roadmap item it
   belongs to.
7. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

## Open questions

None.

## Outcome

Shipped as specified: `apps/demo-aesthetics` (11 collections, 8 Local-API site endpoints, 7 public
pages, 6 admin pages, 14 content-model tests) with zero changes under `packages/*`, and 14 findings
recorded in [DEMO-FINDINGS.md](../DEMO-FINDINGS.md).
