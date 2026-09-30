# 074 — Refresh the official web and recover the demo

- **Status:** in-progress
- **Author:** agent draft
- **Date:** 2026-09-29
- **Branch:** codex/spec-074-web-demo-refresh
- **Affected packages/apps:** apps/www, apps/demo-aesthetics, deployment workflow and operator docs

## Context / Why

The official site is the first proof that ForgeCMS is approaching 1.0, but its current landing page
reads as a functional pre-release inventory rather than a polished product site. Its only global
navigation destination is Docs, while the substantial demo guide is trapped in a large modal that
cannot be linked, refreshed or revisited as a page. The deployed Lumea demo is also unavailable:
on 2026-09-29 its `/api/status`, `/api/site/home`, `/api/site/settings` and login routes returned
HTTP 500. This matches the known post-spec-069 production requirement for a 32-byte-or-longer
`AUTH_SECRET`; after restoring startup, the existing D1 must also be backed up and checked with the
reviewed schema-upgrade workflow before any migration.

This work deliberately pauses roadmap feature expansion to make the existing product credible and
usable. It builds the visible experience from the author's libraries: Volt UI for controls and
surfaces, angular-movement for one restrained explanatory motion, and Lumen Icons for interface
icons. The apps currently pin `@voltui/components` 1.0.1 and `angular-movement` 1.1.0; their current
minor releases are 1.1.0 and 1.2.0. `lumen-icons` 0.2.0 and `quartz-headless` 0.2.1 are already
current.

## Goal

Ship a healthy public demo and a distinctive, production-quality official site whose Demo and Docs
are equally discoverable first-class routes.

## Non-goals

- No new ForgeCMS runtime, adapter, schema DSL or API-envelope behavior.
- No visual rebuild of the Lumea clinic or its reusable admin; this spec fixes deployment health and
  improves its failure guidance only where needed.
- No new public endpoint, remote migration endpoint or secret committed to git.
- No attempt to make a pre-1.0 stability promise; version and experimental status stay explicit.
- No theme switcher, blog, pricing page, testimonials, analytics expansion or decorative animation
  system.
- No new Quartz usage unless an existing headless primitive is clearly needed; it is not a visual
  dependency and should not be added merely to satisfy a library list.
- No changes under `packages/*`, therefore no changeset.

## Design

### Information architecture

The official site has four stable top-level destinations:

```text
ForgeCMS                 Product    Demo    Docs    GitHub
   /                       /        /demo   /docs   external
```

- `GET /demo` is an Angular application route rendered by `DemoPage` with the existing editor and
  developer journeys, credentials and source links from `demo-access.ts`.
- Every old “See the demo” trigger becomes `routerLink="/demo"`. The root-scoped
  `DemoDialogService`, `DemoDialogComponent` and modal-specific focus/Escape behavior are removed.
- Header and footer render ordinary Demo links. On mobile, Product, Demo, Docs and GitHub remain
  keyboard-accessible in the menu.
- `/docs/*` keeps its existing documentation shell; this work changes shared brand/navigation styles
  only where required for consistency.

### Demo page

`forge-cms-demo-page` owns `/demo` and presents one page, not a pseudo-dialog:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Demo label        Lumea Aesthetics, run entirely on ForgeCMS         │
│                  [Open clinic] [Sign in to CMS]                      │
├───────────────────────────────┬──────────────────────────────────────┤
│ Editor journey                │ Angular developer journey            │
│ numbered, executable steps    │ schema → Local API → admin → tests   │
├───────────────────────────────┴──────────────────────────────────────┤
│ shared credentials              source + honest demo findings        │
└──────────────────────────────────────────────────────────────────────┘
```

The two audiences are visible together on wide screens and stacked on small screens; no audience
toggle hides half of the content. Credentials use semantic copy controls from Volt UI where the
upgraded version provides them, with an accessible native fallback if it does not. External actions
name their destination; visible arrow characters are replaced with Lumen icons.

### Landing page visual system

The visual language comes from the existing geometric forged-F mark and from ForgeCMS's actual
pipeline, rather than generic SaaS decoration.

- **Color:** forge ink `#0A0F1A`, paper `#F7F9FC`, steel `#D8E0EA`, arc violet `#8B5CF6`, and
  signal cyan `#22D3EE`. Cyan/violet are used to encode flow and focus, not as ambient gradient
  blobs. Semantic Volt tokens remain the control-system source of truth.
- **Type:** the existing Inter/system family, with a deliberate compact display scale (650 weight,
  tight leading) and readable 17–18px body copy capped near 68 characters. Monospace is limited to
  code, commands and package names.
- **Layout:** left aligned, max-width 1280px, an asymmetric 7/5-column hero, and long horizontal
  “rails” for capabilities and release readiness instead of grids of interchangeable cards.
- **Shape:** radii communicate hierarchy: small for code/control surfaces, medium for the one live
  workbench; repeated floating card shadows are removed.
- **Motion:** one user-triggered or initial orchestrated sequence illustrates
  `TypeScript schema → Local API → Angular admin` with angular-movement. It runs once, never blocks
  content, and becomes static under `prefers-reduced-motion`.
- **Icons:** Lumen Icons supplies navigation, external-link, copy, database, storage, schema and
  Angular-facing symbols. No hand-authored inline SVG remains for common UI icons.

Landing structure:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Header: Product / Demo / Docs / GitHub                               │
├──────────────────────────────────┬───────────────────────────────────┤
│ Angular-first positioning        │ Live Forge workbench              │
│ concise proof + install          │ schema → runtime → admin          │
│ [Start building] [Explore demo]  │ one meaningful motion             │
├──────────────────────────────────┴───────────────────────────────────┤
│ Capability rail: model / policy / content / deploy                  │
├───────────────────────────────┬──────────────────────────────────────┤
│ Local API explanation         │ real route code                      │
├───────────────────────────────┴──────────────────────────────────────┤
│ Packages as one composable system, grouped by responsibility         │
├──────────────────────────────────────────────────────────────────────┤
│ Road to 1.0: completed foundation + next checkpoint, not full wall  │
├──────────────────────────────────────────────────────────────────────┤
│ Final action: docs / demo / GitHub                                   │
└──────────────────────────────────────────────────────────────────────┘
```

The hero copy remains factual: Angular/Analog, TypeScript definitions, Local API, reusable admin,
Cloudflare D1/R2 and portable libSQL. The full roadmap stays in docs; the homepage shows only the
completed foundation, current published version, and next meaningful checkpoint. All claims continue
to derive from `forge-release.ts` and `landing-data.ts` rather than duplicated template strings.

This direction was checked against the frontend-design brief: the first pass risked the familiar
“dark developer landing plus glowing gradient” pattern. The revision keeps a light, steel-like
canvas and spends the brand color and motion only on the concrete content pipeline. The workbench is
specific to a code-first CMS and replaces decorative hero chrome with a useful explanation.

### Dependencies

- Upgrade both private apps to `@voltui/components` `1.1.0`.
- Upgrade `apps/www` to `angular-movement` `1.2.0`; add it to the demo only if demo UI code actually
  needs it (not expected).
- Keep `lumen-icons` at `0.2.0` and `quartz-headless` at `0.2.1`.
- Use only documented entry points from those packages; no source/deep imports.

### Demo recovery and deployment guard

1. Configure a randomly generated `AUTH_SECRET` of at least 32 bytes for the production and preview
   environments of the `forge-cms-demo` Pages project. The value never enters source, workflow logs
   or GitHub Actions inputs.
2. Before any schema change, follow `docs/BACKUP-RESTORE.md` for the demo D1/R2 resources.
3. Run `planSchema()` against production. Safe additive work may use `syncSchema()`; blocking drift
   must use an explicitly reviewed migration under the existing spec-072 workflow. Do not delete
   `_forge_schema` or recreate the database to make the demo pass.
4. Add a post-deploy health check in the `deploy-demo` job. It polls
   `https://forge-cms-demo.pages.dev/api/status` for a bounded interval and fails unless it receives
   HTTP 200 with `data.database`, `data.auth`, `data.storage` and collection counts. It must not print
   secrets or continue silently on failure.
5. The public site's failed-request state gives a useful retry action and a link back to the official
   `/demo` guide; raw red server text is not the only recovery path.

## Implementation plan

- [ ] Recover the `forge-cms-demo` Pages environment with a production secret, backup, schema plan
      and verified 200 responses; record only non-secret operational evidence in the outcome.
- [ ] Upgrade the two private-app dependency pins and lockfile, then inspect the new Volt UI and
      angular-movement APIs before using them.
- [ ] Add `DemoPage` and `/demo`, migrate `demo-access.ts` content, replace modal triggers with route
      links, and remove the obsolete dialog component/service.
- [ ] Rework header, hero, capability/Local API, package, roadmap and footer components around the
      visual system above, using Volt UI primitives and Lumen Icons.
- [ ] Add the single pipeline motion with angular-movement plus reduced-motion/static behavior.
- [ ] Improve the demo public failure state and add a bounded post-deploy health check.
- [ ] Update landing/demo unit and Playwright tests for routing, content, responsive navigation,
      reduced motion, keyboard focus and healthy demo URLs.
- [ ] Run format and all focused app checks, inspect desktop/mobile screenshots, then run the full
      repository quality gates and update `docs/STATE.md` plus this spec's status/outcome.

## Test plan

- `apps/www/src/app/landing-data.test.ts`: release-derived claims and the reduced homepage roadmap
  remain accurate.
- Add a focused route/content test for `DemoPage`: both journeys, both accounts and all external
  destinations render without opening a dialog.
- `apps/www/e2e/landing.spec.ts`: Product/Demo/Docs navigation, no modal, hero CTAs, mobile menu,
  visible focus and the shorter roadmap story.
- Add `apps/www/e2e/demo.spec.ts`: direct load and refresh of `/demo`, editor/developer content,
  credentials, external URLs, mobile stacking and no horizontal overflow.
- `apps/demo-aesthetics/e2e/public-site.spec.ts`: failed public data loads expose retry/help UI; the
  normal content journey remains unchanged.
- Dependency smoke checks: both apps build with Volt UI 1.1.0; `apps/www` builds and tests with
  angular-movement 1.2.0; no deep imports.
- Manual visual review at approximately 390px, 768px, 1440px and 1920px, including reduced motion
  and keyboard-only navigation.
- Live checks after deploy: `/api/status`, `/api/site/home`, `/api/site/settings` return 200; login
  with the published demo admin succeeds; the clinic and CMS journeys promised on `/demo` work.
- Full gates: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, followed
  by `pnpm e2e:www && pnpm e2e:demo`.

## Acceptance criteria

1. `https://forge-cms-demo.pages.dev/api/status`, `/api/site/home` and `/api/site/settings` return
   HTTP 200, and the published admin credentials create a valid session.
2. A failed post-deploy demo health check fails `deploy-demo` instead of reporting a successful
   deployment.
3. `/demo` is directly loadable and refreshable, contains both audience journeys and replaces every
   landing/header/footer demo modal trigger.
4. The global desktop and mobile navigation expose Product, Demo, Docs and GitHub with visible
   keyboard focus and no modal dependency.
5. The landing page uses Volt UI controls/surfaces, Lumen Icons for common UI icons, and exactly one
   purposeful angular-movement sequence with a static reduced-motion rendering.
6. At 390px, 768px, 1440px and 1920px the landing and `/demo` have no horizontal overflow, clipped
   actions or unreadable code/credential content.
7. The homepage's version, package and readiness claims match `docs/STATE.md`, and it no longer
   presents the complete roadmap as the primary product story.
8. Both apps use `@voltui/components` 1.1.0, `apps/www` uses `angular-movement` 1.2.0, and existing
   current `lumen-icons`/`quartz-headless` pins remain unchanged unless implementation evidence
   requires otherwise.
9. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e:www &&
pnpm e2e:demo` are green.

## Open questions

None. The requested route replaces the modal, the official site receives the visual refresh, and the
clinic demo is treated as a reliability target rather than a second redesign in this bounded spec.

## Outcome

Shipped (PR #59): the `/demo` route replacing the modal, the refreshed landing (Volt UI 1.1.0,
angular-movement 1.2.0, Lumen icons, one reduced-motion-aware pipeline motion), mobile navigation,
the demo failure state and the post-deploy demo health check. **Not achieved:** demo recovery —
acceptance 1 failed in production (`/api/status` 500 on every attempt). Spec 075 found the real cause
(blocking schema drift, not a missing `AUTH_SECRET`), added the fix path and a health gate for the
official site too; applying the migrations is pending operator action.
