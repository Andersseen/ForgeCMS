# 056 — Harden Professional UI Quality

- **Status:** done
- **Author:** agent draft (maintainer-directed scope from prompt)
- **Date:** 2026-09-04
- **Branch:** feature/professional-ui-quality-hardening
- **Affected packages/apps:** `apps/www`, `apps/demo-aesthetics`, `@forge-cms/admin`,
  `@forge-cms/angular`; `apps/tiny-project` as regression/reference only; other `packages/*` only for
  confirmed bugs, security issues, performance issues, accessibility issues, or incorrect public
  behavior found during the audit

## Context / Why

Spec 055 proved that ForgeCMS can power a deliberately tiny consumer through a real browser, local
D1, libSQL, and packed public packages. The next problem is presentation and trust: the product is
functionally broad enough for a `0.4.x` patch hardening pass, but the website, demo, and reusable
admin still contain rough edges that make ForgeCMS feel more like an implementation demo than a
polished open-source product. This branch should improve quality, consistency, accessibility,
security posture, performance, and tests without adding new CMS capabilities.

Initial audit notes from the current `main` branch:

- `apps/www` is already componentized (`HeroSectionComponent`, `HeaderComponent`, docs shell, docs
  article/sidebar) and uses Volt UI, but the homepage CTA hierarchy still competes between demo,
  docs, and architecture, and the hero shows code rather than a clear product/admin preview.
- `/docs` already has grouped sidebar navigation, mobile `<details>`, prose styling, code blocks, and
  previous/next links. It needs a polish pass, content accuracy pass, and better discovery of the
  small-project guide from the first-run visitor path.
- `@forge-cms/admin` already uses Volt UI and Lumen Icons heavily. Concrete audit candidates include
  decorative/nonfunctional header search and notification controls, a footer avatar loaded from
  `https://i.pravatar.cc`, icon buttons that need accessible names, hand-rolled modal overlays, and
  density/spacing inconsistencies across lists, forms, and auth screens.
- `ForgeSignInComponent` currently navigates to the raw `returnUrl` query value. This must be audited
  and covered so an external or malformed redirect target cannot become a security bug.
- `ForgeCollectionFormComponent` is modal-like but lacks the dialog semantics/focus behavior present
  on `ForgeConfirmDialogComponent`; both overlays should receive a keyboard/focus pass.
- `apps/demo-aesthetics` is a useful real-world showcase, but public pages still expose
  implementation-demo language ("Every word, price and image..."), use SVG placeholder-style assets,
  lack a mobile navigation pattern, and have simple `Loading...`/raw error text in several pages.
- Current Playwright configs cover desktop Chromium only, and no axe dependency is present.

## Audit Log

The implementation audit starts from these concrete findings. Add to this list as new issues are
found, and leave `NO CHANGE NEEDED` notes where an audited surface is already sound.

| Category          | Surface                                                           | Finding                                                                                                                                                        | Planned action                                                                                                                    |
| ----------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| SECURITY          | `packages/admin/src/signin.component.ts`                          | Sign-in reads `returnUrl` directly from the query string and passes it to `router.navigateByUrl`.                                                              | Add a safe same-app admin redirect helper and regression tests for external, protocol-relative, malformed, and valid admin paths. |
| SECURITY          | `packages/admin/src/signup.component.ts`                          | Sign-up currently falls back to a configured redirect only; keep it aligned with the same safe redirect helper if `returnUrl` support is introduced or shared. | Share the redirect helper without changing signup behavior beyond safe fallback coverage.                                         |
| VISUAL POLISH     | `packages/admin/src/layout.component.ts`                          | Footer avatar loads from `https://i.pravatar.cc`, creating an unnecessary external image dependency in reusable admin chrome.                                  | Use deterministic initials/fallback identity unless a future host API explicitly supplies an avatar.                              |
| UX INCONSISTENCY  | `packages/admin/src/layout.component.ts`                          | Header search input and bell icon are decorative; they imply unsupported global search/notifications.                                                          | Remove or de-emphasize them so admin chrome reflects real capabilities.                                                           |
| ACCESSIBILITY     | `packages/admin/src/layout.component.ts`                          | Mobile sidebar toggle lacks a visible hidden text label and icon-only controls need a quick accessible-name pass.                                              | Add `aria-label`/`sr-only` text where needed and preserve Lumen icon usage.                                                       |
| ACCESSIBILITY     | `packages/admin/src/collection-form.component.ts`                 | The document editor overlay behaves like a dialog but lacks `role="dialog"`, `aria-modal`, title wiring, escape handling, and focus guidance.                  | Add semantic dialog attributes and keyboard handling without replacing the form architecture.                                     |
| ACCESSIBILITY     | `packages/admin/src/confirm-dialog.component.ts`                  | Confirm dialog has basic semantics but no escape handling/focus placement.                                                                                     | Add focused keyboard behavior if it can be done simply and tested.                                                                |
| EMPTY STATE       | `packages/admin/src/collection-list.component.ts`                 | Empty list text is generic and does not distinguish no documents from no search results; create CTA is separate from the empty state.                          | Make empty state copy/action clearer while respecting read-only roles.                                                            |
| DOCS PRESENTATION | `apps/www/src/app/pages/docs/*`                                   | Docs shell already has sidebar, mobile `<details>`, prose styles, and previous/next links.                                                                     | Polish only; no new docs framework.                                                                                               |
| VISUAL POLISH     | `apps/www/src/app/components/hero-section.component.ts`           | Homepage hero centers a schema/code preview; product/admin UI is less visible than the implementation.                                                         | Improve CTA hierarchy and show current product surfaces without fake functionality.                                               |
| APP-SPECIFIC      | `apps/demo-aesthetics/src/app/pages/site/site-shell.component.ts` | Public footer says every word/image is stored in ForgeCMS and links to admin with implementation-showcase copy.                                                | Rewrite public copy so the clinic site feels real while preserving an admin showcase link.                                        |
| RESPONSIVE ISSUE  | `apps/demo-aesthetics/src/app/pages/site/site-shell.component.ts` | Public navigation is desktop-only; mobile users only see the Book CTA.                                                                                         | Add a simple mobile navigation disclosure using existing routes.                                                                  |
| LOADING UX        | `apps/demo-aesthetics/src/app/pages/site/*.ts`                    | Several pages render bare `Loading...`/raw error lines.                                                                                                        | Introduce simple consistent public loading/error blocks, not a skeleton framework.                                                |
| TEST GAP          | Playwright configs                                                | Website/demo/tiny-project E2E currently use desktop Chromium only; no axe dependency is installed.                                                             | Add targeted tests first; add axe only if it fits cleanly and pays for itself.                                                    |
| NO CHANGE NEEDED  | `apps/tiny-project`                                               | Tiny project remains the regression/reference consumer from spec 055.                                                                                          | Use it only when shared admin/auth behavior changes need external-style proof.                                                    |

## Goal

Ship one coherent `0.4.x` patch-quality branch that makes the official site, documentation,
demo-aesthetics public/admin surfaces, and reusable admin experience feel visually coherent,
accessible, resilient, secure, and professionally test-covered, while preserving all existing product
capabilities and package boundaries.

## Non-goals

- No new CMS features: no new field kinds, workflow, autosave, saved filters, bulk actions, OAuth,
  password reset email, image-processing pipeline, plugin system, CLI, analytics, or new adapter.
- No Glossa-specific behavior and no consumer-specific assumptions in shared packages.
- No redesign of adapter contracts, runtime contracts, auth contracts, API envelopes, or persisted
  schemas unless a confirmed bug requires a backward-compatible fix.
- No broad backend architecture refactor. Stable backend packages are touched only for confirmed
  bug/security/performance/accessibility/public-behavior issues discovered during this pass.
- No new documentation framework, screenshot-generation subsystem, or heavy visual-regression system.
- No public package minor bump because of breadth. Package changes, if any, should receive patch
  changesets only.
- No manual publishing, forced versions, tag changes, or release automation outside normal
  changesets/CI behavior.

## Design

### 1. Quality Bar

ForgeCMS should read as clean, modern, developer-oriented, calm, consistent, and dense enough for a
CMS work surface. Prefer clear hierarchy, strong typography, restrained color, practical spacing,
obvious statuses, predictable layouts, and useful interaction feedback.

Avoid huge gradients everywhere, random glassmorphism, oversized nested cards, excessive whitespace,
fake dashboards, unsupported marketing claims, unnecessary animation, or visual language copied from
Payload/Strapi/Directus. ForgeCMS should keep its own identity.

### 2. Audit Classification

Before implementation, record a short audit note in this spec (or a linked section inside this file)
classifying findings under these labels:

- VISUAL POLISH
- UX INCONSISTENCY
- ACCESSIBILITY
- RESPONSIVE ISSUE
- DARK/LIGHT ISSUE
- PERFORMANCE
- CODE QUALITY
- DUPLICATION
- SECURITY
- ERROR UX
- LOADING UX
- EMPTY STATE
- TEST GAP
- E2E GAP
- DOCS PRESENTATION
- APP-SPECIFIC
- NO CHANGE NEEDED

Findings can be small, but they must be concrete: file/surface, observed problem, intended action,
and whether it is app-only or package-impacting.

### 3. Official Website

Improve the existing `apps/www` architecture rather than replacing it. The homepage should quickly
answer what ForgeCMS is, why Angular/Analog, why Cloudflare-first, what works today, whether a
portable profile exists, how to start, where docs live, and where GitHub lives. Use only capabilities
actually present.

Expected positioning:

```text
A TypeScript-first headless CMS with a native Angular/Analog experience, Cloudflare-first
infrastructure, portable core adapters, and an embeddable admin.
```

Concrete work should include:

- Clarify homepage CTA hierarchy: likely `Get started`, `View docs`, `GitHub`, with demo as a clear
  supporting proof rather than one of many equal buttons.
- Make the small-project guide prominent from the homepage, docs start page, and quickstart.
- Replace or augment code-only previews with real product/admin UI previews where practical, without
  fake functionality or a screenshot subsystem.
- Polish navigation, footer, architecture/package sections, mobile nav, and link purpose.
- Use Volt UI and Lumen Icons consistently. Do not add another icon library.

### 4. Documentation Experience And Accuracy

Keep the Analog content pipeline and the fixed inline-code escaping behavior intact. Improve
readability, sidebar hierarchy, active state, mobile navigation, content width, heading rhythm, inline
code, code blocks, tables, notes/warnings, anchors, and previous/next links where current support
already exists.

Audit docs for stale pre-052 through pre-055 guidance, especially:

- `localStorage` auth as the default browser/admin model
- app-local CRUD/admin pages where package components are now the intended path
- manual `passwordHash` fields instead of `defineUsersCollection()`/`withAuthFields()`
- old login/signup wiring
- old users-management implementation
- copied private Angular linker plugins instead of `@forge-cms/admin/vite`
- incorrect signup route/link behavior
- obsolete package versions or baseline statements

Do not rewrite every doc page. Patch the stale snippets and improve the beginner path:

```text
landing -> get started -> small project guide -> working ForgeCMS app
```

### 5. Demo Aesthetics

Treat `apps/demo-aesthetics` as the main public showcase. Improve it using the existing content model
and current CMS capabilities only.

Concrete work should focus on homepage, services/treatments, detail pages, journal, team, booking,
navigation, footer, CTAs, cards, typography, spacing, responsive behavior, missing images, loading
states, empty/fallback states, and 404/error surfaces.

Remove accidental implementation-demo feeling from public-facing copy and UI. The demo may still
link to `/admin` as a product showcase, but it should look first like a plausible small business site
powered by ForgeCMS, not a developer fixture explaining its internals.

### 6. Reusable Admin And Angular Client

Keep package changes scoped to polish, hardening, tests, and bug fixes. Preserve public selectors and
contracts unless a backward-compatible addition is required.

Audit and improve:

- Admin layout density, sidebar width, header, breadcrumbs, page padding, table row heights, form
  spacing, status badges, pagination, search/filter controls, and empty/loading/error states.
- Decorative controls. Header search and notification controls must either become truthful/useful
  within existing capabilities or be removed/de-emphasized.
- User identity. Remove the external `pravatar.cc` avatar dependency from reusable admin UI unless
  a host explicitly supplies an avatar; fallback initials are enough.
- Auth pages. Sign-in/sign-up should feel first-class, with good labels, focus, password visibility,
  validation, error messaging, loading state, and mobile behavior.
- Return URL handling. Add a small shared helper or component-local guard so sign-in/sign-up only
  navigates to safe same-app admin paths. Add regression tests for external, protocol-relative, and
  malformed `returnUrl` values.
- Dialogs and overlays. Use semantic dialog behavior, accessible names/descriptions, keyboard escape
  handling where appropriate, focus placement/restoration where practical, and no background click
  traps that create accidental data loss.
- Forms. Improve label hierarchy, required indication, help/error placement, focus states, disabled
  states, and validation feedback for existing field controls only.
- Collection list/editor. Improve create/edit/save/publish/delete clarity, dirty/cancel flow,
  validation errors, success feedback, search/no-results empty state, and read-only role affordances
  without adding saved filters, bulk actions, autosave, scheduling, or workflow.
- Users workspace. Polish identity presentation, role selector, create/edit flow, last-admin UX,
  delete confirmation, current-user context, loading/error/empty states, and security invariants.

`@forge-cms/angular` may be touched for real client/session bugs, testability helpers, safe redirect
helpers, or error-message behavior. It should not grow new product APIs unrelated to this spec.

### 7. Accessibility

Perform a focused accessibility pass across:

- official homepage and docs
- reusable sign-in/sign-up
- admin layout/sidebar
- collection index/workspace/list/editor
- field controls/richtext/relation/upload controls
- dialogs
- users workspace
- demo public pages

Check landmarks, heading order, labels, `aria-describedby`, error announcement, focus visibility,
focus management, keyboard navigation, dialog semantics, table headers, button accessible names, link
purpose, contrast, reduced motion, and disabled states. Prefer semantic HTML over ARIA.

If `@axe-core/playwright` fits the current Playwright setup cleanly, add it and cover representative
pages. If not, record why it was deferred and keep the manual keyboard/a11y checklist in the spec.

### 8. Performance And Resilience

Measure before optimizing. Audit website/demo/admin for large assets, wrong intrinsic image sizes,
missing lazy loading, avoidable layout shifts, unnecessary eager imports, duplicate requests,
duplicate `/me` calls, repeated collection metadata fetches, signal/effect loops, and expensive
computed work.

Preserve spec 054's "one `/me` bootstrap per app load" behavior. Do not add caching complexity unless
a measured duplicate request or rerender warrants it.

UI failure cases should not become blank screens, uncaught exceptions, raw SQL/stack traces,
`[object Object]`, or infinite navigation. Map validation, unauthorized, forbidden, not found,
conflict, and server unavailable states into existing error components/patterns.

### 9. Tests

Do not chase vanity coverage. Add behavior tests where the audit finds real risk.

Likely unit/component targets:

- `ForgeSignInComponent` and `ForgeSignUpComponent` safe redirect/error/loading behavior
- `ForgeAdminLayoutComponent` visible nav, truthful header controls, logout, user fallback identity
- `ForgeCollectionWorkspaceComponent` query state, loading/error/no-results/delete/status behavior
- `ForgeDocumentEditorComponent` dirty/save/error behavior
- `ForgeCollectionFormComponent` and `ForgeConfirmDialogComponent` dialog semantics/keyboard behavior
- `ForgeUsersWorkspaceComponent` create/edit/delete/last-admin/error behavior
- docs nav, active routes, mobile docs disclosure, code rendering helpers
- demo public mappers/fallback rendering where logic exists

Likely E2E coverage:

- `apps/www`: homepage loads, primary navigation works, docs opens, small-project guide is reachable,
  GitHub/docs CTA destinations are correct, and mobile navigation works.
- `apps/www`: compact admin happy path: sign in, open collection, create/edit/publish/search/delete
  document, users workspace, logout.
- `apps/www` or `apps/tiny-project`: compact role-boundary pass: editor cannot manage users; viewer
  does not see write controls where server policy is read-only.
- `apps/demo-aesthetics`: public journey from homepage to service/treatment, CTA/navigation, and a
  mobile navigation pass.

Visual regression should be audited before adding. Add only a tiny stable set if Playwright snapshots
are deterministic and valuable; otherwise defer explicitly.

## Implementation plan

- [x] Run the visual/UX/a11y/security/performance/test audit over `apps/www`,
      `apps/demo-aesthetics`, `packages/admin`, `packages/angular`, and `apps/tiny-project` as a
      reference consumer; record classified findings in this spec before broad edits.
- [x] Define the final visual quality checklist from the audit and confirm which items are app-only
      versus package-impacting.
- [x] Polish `apps/www` homepage/navigation/footer/product preview/CTA hierarchy and route beginners
      toward the small-project guide.
- [x] Polish `/docs` presentation and patch stale docs introduced by specs 052-055 changing the
      recommended auth/admin consumer path.
- [x] Polish `apps/demo-aesthetics` public site and app-local admin surfaces without adding CMS
      features or changing its content model.
- [x] Polish `@forge-cms/admin` layout, auth pages, collection list/editor, field/form controls,
      users workspace, dialogs, loading/empty/error/success feedback, and density.
- [x] Fix confirmed security issues such as unsafe `returnUrl` handling or unsafe content/link
      rendering, with focused regression tests.
- [x] Add accessibility improvements and representative automated a11y checks if the tooling addition
      is justified.
- [x] Add focused unit/component tests for meaningful admin/angular/site/demo behavior found weak in
      the audit.
- [x] Strengthen compact Playwright journeys for website, admin happy path, role boundaries, and demo
      public experience; add mobile/tablet projects or targeted mobile specs where useful.
- [x] Audit performance/assets/lazy loading and fix measured or obvious problems without creating new
      pipelines.
- [x] Add patch changesets for any `packages/*` changes; do not add changesets for app-only changes.
- [x] Run the test plan and full quality gates, update `docs/STATE.md`, and mark this spec `done`
      with an outcome note when complete.

## Test plan

- `pnpm --filter @forge-cms/admin test`
- `pnpm --filter @forge-cms/angular test`
- `pnpm --filter @forge-cms/www test`
- `pnpm --filter @forge-cms/demo-aesthetics test`
- `pnpm e2e:www`
- `pnpm e2e:demo`
- `pnpm e2e:tiny-project` if shared admin/auth behavior changes need the external-style regression
  consumer
- Manual keyboard-only pass over sign-in, sidebar navigation, collection open, new document, form
  edit/save/cancel, delete confirmation, users management, logout, docs mobile nav, website mobile
  nav, and demo mobile nav
- Manual dark/light pass for surfaces that already support theme switching: admin layout, forms,
  tables, dialogs, badges, code blocks, hover/focus/disabled states
- Browser/devtools performance spot checks for official homepage, docs article, admin collection
  workspace, document editor, and demo homepage/service detail
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## Acceptance criteria

1. The spec contains an implementation-time audit table/list with classified findings and `NO CHANGE
NEEDED` notes for audited surfaces that do not require edits.
2. The official homepage explains ForgeCMS accurately, has clear primary CTAs, links prominently to
   docs/GitHub/small-project guide, and does not make unsupported claims.
3. `/docs` remains on Analog content, renders inline code/code blocks correctly, and no longer teaches
   stale auth/admin/linker/signup guidance from before specs 052-055.
4. `apps/demo-aesthetics` public pages feel like a plausible clinic site, not an implementation demo,
   and work at desktop and mobile breakpoints.
5. The reusable admin has consistent density, controls, statuses, empty/loading/error states, and no
   decorative controls that imply unsupported capabilities.
6. Auth pages and admin dialogs are keyboard usable, labeled, focus-visible, and responsive.
7. External/protocol-relative/malformed `returnUrl` values cannot navigate the user away from the app;
   regression tests prove the safe fallback.
8. Browser-side auth still does not store session token, password, `passwordHash`, or `AUTH_SECRET` in
   `localStorage`, `sessionStorage`, or IndexedDB. Theme preferences may continue to use
   `localStorage`.
9. No raw SQL, stack traces, `[object Object]`, internal debug data, or password hashes are rendered in
   user-facing errors or admin tables.
10. Representative automated or documented manual accessibility checks cover homepage, docs, sign-in,
    collection workspace, document editor, users workspace, and demo homepage.
11. Compact E2E coverage proves website navigation, docs discovery, admin happy path, role boundaries,
    and demo public navigation without brittle page-wide snapshots.
12. Performance/asset fixes are based on audit observations; no new image pipeline or broad caching
    architecture is introduced.
13. Package boundaries remain intact: apps do not deep-import from `packages/*/src`, shared packages
    do not import app code, and app-specific branding/copy stays app-local.
14. Any touched `packages/*` package has a patch changeset only if its published behavior/assets/types
    changed.
15. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` is green before this spec is marked
    `done`.

## Open questions

None. Resolved during implementation:

- The official homepage keeps the current in-app demo dialog, but demotes it below the primary
  `Get started`/docs/GitHub path.
- `@axe-core/playwright` was not added in this pass; the current improvements were semantic and
  covered by focused unit/E2E tests without introducing a new dependency.
- Visual snapshots were deferred; this branch keeps visual QA semantic/behavioral to avoid a
  maintenance-heavy baseline system.

## Outcome

Shipped safe admin auth redirects, removed decorative reusable-admin chrome, removed reusable-admin
external avatar loading, improved dialog semantics and collection empty-state actions, clarified the
official homepage beginner path, patched stale docs copy, softened the demo site's
implementation-demo language, added demo mobile navigation, and added/updated focused unit and E2E
coverage. Added a patch changeset for `@forge-cms/admin`. Verified with `pnpm lint`,
`pnpm typecheck` (via `rtk proxy` because the RTK wrapper returned a false nonzero status while
printing "No errors found"), `pnpm test`, `pnpm build`, `pnpm format:check`,
`pnpm --dir apps/www e2e`, `pnpm --dir apps/demo-aesthetics e2e`, and
`pnpm --dir apps/tiny-project e2e`.
