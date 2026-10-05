# 079 — Redesign the official product web

- **Status:** done (implemented and verified; PR #73 pending merge)
- **Author:** agent draft
- **Date:** 2026-10-05
- **Branch:** feature/spec-079-official-web-redesign
- **Affected packages/apps:** apps/www (public marketing surface only), docs/specs, docs/STATE.md

## Context / Why

The maintainer requests one PR that makes the official website visually compelling, modern and
professional, using VoltUI, Angular Movement and Lumen Icons throughout. The current site from
spec 074 is functional but leads with a small technical pipeline and lengthy implementation
inventories; it does not give the product a memorable visual demonstration.

References supplied by the maintainer: [Payload](https://payloadcms.com/) for the product-first
presentation of a code-first CMS; [Soup Zero](https://trysoup.dev/zero) for its workbench-oriented
presentation and visual mood; [OmniRoute](https://www.omniroute.online/es/) for exploration and UX.
These are references, not assets to copy. Their pages and desktop screenshots were inspected on
2026-10-05 before completing the visual design. The maintainer approved this spec in the session.
This spec replaces the visual direction of spec 074 without reopening its demo recovery work.
It is independent of the runtime roadmap and the demo findings.

## Goal

Ship a distinctive official product website that lets visitors understand ForgeCMS, explore a
schema-to-content demonstration and reach the real demo or getting-started guide within one PR.

## Non-goals

- No changes under packages/\*, to runtime behaviour, adapters, auth, API responses or schemas.
- No redesign of /admin, apps/demo-aesthetics, apps/tiny-project or apps/playground.
- No live mutation, login or remote API request from the homepage showcase.
- No documentation content rewrite, new public routes, translation system or dependency upgrades.
- No fabricated customer logos, testimonials, usage numbers, latency claims or enterprise promises.
- No blog, pricing page, account funnel, analytics expansion.
- No production deployment, remote migrations or release publication in this PR.

## Design

### Direction and tokens

The existing /logo.svg remains the brand source. The proposal uses a spacious ink canvas for the
hero and showcase, then a bright reading surface for capabilities and guides. The showcase is the
memorable element; surrounding typography and navigation stay quiet.

| Token       | Value   | Role                                                 |
| ----------- | ------- | ---------------------------------------------------- |
| Forge ink   | #0A0F1A | Hero and showcase shell; directly from the logo      |
| Arc violet  | #8B5CF6 | Brand accent and selected-state decoration           |
| Signal cyan | #22D3EE | Pipeline connections and highlights on dark surfaces |
| Paper       | #F7F9FC | Light reading sections                               |
| White       | #FFFFFF | Primary dark-surface text and light panels           |
| Steel       | #D8E0EA | Light-surface separators                             |

Use accessible darker variants for violet/cyan text on paper; check actual computed contrast rather
than assuming logo colours are suitable for small text. Scope marketing tokens to a landing wrapper
and reuse Volt semantic tokens for controls. Do not change global :root or .dark values used by admin.

Typography uses a deliberately large system sans display (no remote font dependency), with
approximately 64–104px desktop headlines, 40–48px mobile headlines and 17–19px body text. Keep
paragraphs below 68 characters, use monospace only for code and commands, and use sentence case.
The proposed headline is “Your content. Your code. Your Angular.” Supporting copy explains the
TypeScript schema, Local API, Angular admin and D1/R2 or libSQL without promising 1.0 stability.

Use a centred, max-width 1280px hero with a wide showcase beneath it, followed by left-aligned
reading sections. This intentionally changes spec 074's narrow asymmetric hero. Avoid repeated
identical cards, perpetual particles, gradients behind every section and an exhaustive roadmap wall.
Any lighting treatment stays inside the showcase and uses the logo colours.

### Page composition

```text
Brand          Product  Demo  Docs  GitHub       Start building

             Your content. Your code. Your Angular.
          Concise positioning + experimental/version badge
                [Start building] [Explore the live demo]

  ┌────────────────────────────────────────────────────────────┐
  │ ForgeCMS showcase             Schema | Content | API       │
  │ Collection definition / read-only editor / JSON response   │
  │          One schema connects the whole experience          │
  └────────────────────────────────────────────────────────────┘
                  Copyable install command

  Model your content           Real capabilities + guide links
  Keep control of the backend  Local API example + deployment profiles
  See a real project           Lumea demo invitation
  Build from composable parts  Compact package inventory
  Follow the road to 1.0       Honest, short readiness summary
  Final action + footer
```

Retain Product / Demo / Docs / GitHub destinations and the existing /#product anchor. Keep
“Start building” -> /docs/small-project-guide and “Explore the live demo” -> /demo. Marketing copy
remains English, matching repository conventions. The mobile menu closes on navigation and Escape,
returns focus to its trigger on Escape, and exposes aria-expanded and aria-controls. Include a
keyboard-visible skip link. Avoid nested main landmarks when composing the page.

### Showcase component and interaction contract

Add app-local standalone OnPush `ProductShowcaseComponent`, selector `forge-cms-product-showcase`.
It has no public inputs or outputs, no exported package API and no server dependency.

```ts
type ShowcaseView = 'schema' | 'content' | 'api';
// Internal state, not a published API:
// selected = signal<ShowcaseView>('schema')
// select(view: ShowcaseView): void
```

Use the installed VoltUI tabs primitives after inspecting their actual API. All three tabs have
proper tab/tabpanel relationships, one selected tab, arrow-key/Home/End navigation and visible focus.
If installed Volt primitives do not supply this behaviour, compose their documented headless
facilities rather than creating a second general-purpose tabs implementation.

- **Schema:** valid defineCollection/defineField example based on existing landing-data.ts.
- **Content:** a read-only presentation of the corresponding post title, slug and publication
  status using VoltUI surfaces/badges. Explicitly label it “Illustrative preview”; it does not imply
  that a visitor has entered a working admin. Do not expose dead Save/Publish controls.
- **API:** example JSON with the real item envelope { data }, matching the same content fixture.

Use one internally consistent static fixture. No timeouts, auto-advancing tabs, fake network status
or live visitor data. Initial view is Schema on every direct load. All content is immediately
available, and selecting a tab changes only the local view.

Angular Movement supplies one restrained initial showcase entrance and short user-triggered view
changes. Inspect its installed API and reduced-motion handling before implementation. When
prefers-reduced-motion is reduce, content remains visible without transforms or delayed visibility;
CSS alone must not be assumed to disable library-driven animations. No layout shift when tabs change.
Lumen Icons supplies navigation, code, content, storage, copy and external-link symbols through its
documented exports; preserve /logo.svg for the brand.

The install command uses a VoltUI copy primitive if one is available. Clipboard success announces
“Copied” in a polite live region; rejection keeps the command selectable and shows “Select and copy
the command”. Copy only on a user action, with no clipboard permission request on initial load.

### Scope and content truth

Edit landing.page.ts and the marketing components under apps/www/src/app/components. Shared
HeaderComponent/FooterComponent may receive compatible navigation improvements on /demo and /docs;
retain their current destinations and keep docs prose styling stable. New landing CSS belongs in a
component stylesheet or under a dedicated marketing ancestor in styles.css. Avoid body-wide palette
or font changes that affect /admin. Keep index.html metadata accurate if the headline changes.

Use forge-release.ts as the existing release source; do not insert hardcoded versions or claim
that implemented branch work is published. Capability text must match main code and STATE.md,
including the distinction between API version history and admin history UI. Update stale “next
patch release” wording only after verifying the feature is released. Keep package versions derived
from FORGE_PACKAGES and CURRENT_FORGE_VERSION. No dependency or lockfile change is expected.

### Maintainer-approved shared light/dark theme (2026-10-05)

The maintainer reviewed PR #73 and explicitly requested a shared, user-selected light/dark theme:
Home, Demo and Docs must no longer look like separate themes. This supersedes the earlier fixed
ink hero / paper reading-surface treatment and the theme-toggle non-goal.

- Add one app-local `SiteThemeService` with `toggle()`, `restore()` and an `isDark` signal; use
  VoltUI `applyVoltTheme` and its standard `.dark` class, not a second component theme engine.
- Default to the OS preference until the user chooses light or dark. Persist explicit choices under
  the existing `forgecms-theme` key so the app-local public shell and the existing admin agree.
  Invalid or unavailable storage falls back safely; switching still works when storage is blocked.
- Render an accessible Volt button with Lumen sun/moon icons in the shared header, available on
  desktop and mobile, labelled with the action (“Switch to dark/light mode”).
- Initialise the root theme before first paint in index.html; restore it in the Angular shell and
  on route navigation. Honour OS changes when there is no explicit choice. No backend/API changes.
- Home, Demo and Docs share a scoped `forge-public` palette. Convert fixed backgrounds, text,
  showcase/editor panels, Local API illustration, demo source panel, footer and docs code colours
  to the selected theme. Retain the logo and violet/cyan brand accents with accessible variants.
- Add browser tests for both themes across all three routes, reload persistence, mobile control,
  system default/change, invalid/blocked storage and early bootstrap. Review both palettes at
  mobile/desktop sizes and re-run existing gates and www e2e. Keep this work in PR #73.

## Implementation plan

- [x] Create feature/spec-079-official-web-redesign from main; visually inspect references and current
      site, and inspect installed VoltUI, Angular Movement and Lumen APIs.
- [x] Build the scoped token system and new hero in landing.page.ts / hero-section.component.ts.
- [x] Add ProductShowcaseComponent with consistent fixtures, accessible Volt tabs and static previews.
- [x] Add copy feedback and restrained Angular Movement behaviour, including reduced motion.
- [x] Recompose architecture, packages, roadmap and final demo invitation around the page structure.
- [x] Polish shared header/footer and keyboard navigation without changing routes or admin styles.
- [x] Update landing-data.test.ts and e2e/landing.spec.ts; run focused checks and inspect screenshots.
- [x] Run formatting, full quality gates and www e2e; update STATE.md and record outcome/evidence.
      No changeset is required because packages/\* is out of scope.
- [x] Open one PR into main containing only the official-site work and its spec/status documentation.

- [x] Implement and validate the maintainer-approved shared theme follow-up above.

## Test plan

- landing-data.test.ts: fixture agrees across schema/content/API; release-derived content stays accurate.
- e2e/landing.spec.ts: all three tabs, arrow-key navigation, selected/controlled panels, copy success
  and denied clipboard fallback, mobile menu Escape/focus, primary links and skip link.
- Desktop and mobile keyboard checks; reduced-motion rendering with no invisible showcase content.
- Screenshots at 390, 768, 1440 and 1920px; inspect hero balance, tab layouts, readable code,
  sticky header, footer and no document-level horizontal overflow. Review all three showcase states.
- Existing docs.spec.ts and demo.spec.ts: direct routes, navigation and readable shared shell.
- Existing auth/admin e2e tests: no regressions from shared styles. No adapter contract tests needed.
- pnpm format:check, pnpm lint, pnpm typecheck, pnpm test, pnpm build, pnpm e2e:www.

## Acceptance criteria

1. Diff is limited to apps/www plus this spec and STATE.md; packages, other apps, server API,
   deployment files, dependency manifests and lockfile are unchanged.
2. Homepage contains the logo palette, revised hero, VoltUI showcase with three keyboard-operable
   views, factual capabilities, demo invitation and final actions.
3. Product/Demo/Docs/GitHub destinations and both primary CTA routes pass Playwright assertions.
4. Showcase and clipboard behaviour pass the focused e2e tests, with no homepage network mutation.
5. Reduced-motion content is visible and usable; keyboard focus and mobile menu behaviour pass tests.
6. Screenshot review at all four widths finds no clipped CTA, unreadable text or document overflow;
   scoped styles preserve docs/demo/admin functionality in the existing www suite.
7. No fabricated claims or hardcoded release numbers; package/readiness assertions remain green.
8. pnpm lint && pnpm typecheck && pnpm test && pnpm build are green, along with www e2e and formatting.

## Open questions

None required. The palette, scope and three-library requirement are supplied by the maintainer;
the proposed composition and copy above are concrete defaults for approval.

## Outcome

Implemented on `feature/spec-079-official-web-redesign`, [PR #73](https://github.com/Andersseen/ForgeCMS/pull/73) pending merge: centred
brand-colour hero, VoltUI Schema/Content/API showcase, Angular Movement opacity transitions,
Lumen Icons, copy feedback, accessible navigation, Lumea invitation and revised product sections.
Published version verified with `pnpm view @forge-cms/core version`: `0.9.3`.

Evidence by acceptance criterion:

1. `git diff --name-only main`: apps/www and spec/status docs only; no manifests, lockfile or backend edits.
2. Desktop/mobile screenshot inspection and the landing e2e suite show all requested sections/libraries.
3. Landing route assertions plus existing docs/demo e2e tests pass.
4. Showcase keyboard/panel and clipboard success/denial tests pass; the showcase test observes zero mutations.
5. Escape/focus, skip-link and all four reduced-motion viewport tests pass. Reduced-motion views are
   immediately opaque; any CSS transition present has a duration of at most 1ms, with no visible motion.
6. Inspected full-page and all three showcase screenshots at 390/768/1440/1920px; no page overflow.
   At tablet widths the explanatory sidebar is hidden to keep the main panel readable; phone code is
   independently scrollable by keyboard. Existing admin/auth/docs/demo tests remain green.
7. Release-derived tests pass; stale migration wording corrected after verifying its released status.
8. `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, `pnpm format:check`, and
   `pnpm e2e:www` (33/33) pass. Workspace gates mix freshly executed www checks with Turbo cache
   hits for unaffected packages. Integration tests require local socket access; the first sandboxed
   test run failed with `listen EPERM`, and the authorised rerun passed.

The maintainer-approved theme amendment is implemented in the same PR: shared public palette,
header control, persisted choice, OS fallback/change handling and early theme bootstrap. Home,
Demo and Docs were visually inspected in light and dark at 390/1440px. `e2e/theme.spec.ts` covers
both palettes (including the Content preview), route/reload persistence, mobile, system changes,
invalid/blocked storage and theme application before Angular starts. www e2e now passes **41/41**;
format:check and the full lint/typecheck/test/build gates pass after the amendment.

No unapproved scope divergence, dependency upgrade, package change, changeset or deployment. Screenshot
artifacts are local review evidence in `/tmp/forge-final-*.png` and `/tmp/forge-showcase-*.png`;
they are not production assets or committed files.
