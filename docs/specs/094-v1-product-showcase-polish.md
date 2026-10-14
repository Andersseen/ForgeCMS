# 094 — ForgeCMS 1.0 product showcase polish (official website + Lumea demo)

- **Status:** done (pending maintainer review)
- **Author:** agent draft (maintainer-requested pre-L02 presentation packet)
- **Date:** 2026-10-14
- **Branch:** `feature/spec-094-v1-showcase-polish`
- **Affected packages/apps:** `apps/www`, `apps/demo-aesthetics`, app-level tests, `docs/DEMO-FINDINGS.md`. **No `packages/*` change.**

## Context / Why

Main (`4a0e9a9`, PR #99) carries the `1.0.0-rc.1` candidate, the experimental Agent Kit and verified Analytics onboarding. The public website and the Lumea demo were designed before that feature set:
the homepage says "Ten focused packages" (there are twelve), omits `@forge-cms/s3` and `@forge-cms/agent`, does not present localization, Agent Kit or Analytics, and the demo does not exercise localization.

Registry truth at start: npm `latest` = `0.13.4`; no `rc` dist-tag; `@forge-cms/agent` is **not published** (E404). The RC is prepared, not published.

## Goal

The official website accurately presents the complete 1.0 candidate product, clearly distinguishes stable from experimental capabilities, and the Lumea demo visibly demonstrates a real client-site workflow with
the current stack. Both are polished, responsive, accessible and truthful, without new package features.

## Non-goals

No `packages/*` change; no public API / Agent Kit API / Analytics API change; no new field kinds; no richer localization; no email, CLI, plugin system, Strata Server Components or page builder; no redesign of
Forge's identity; no fake analytics data presented as real; no claim that an unpublished package is installable; no `1.0.0`/RC publish; no dist-tag change; no remote Cloudflare mutation; no SSR migration of Lumea;
no migration of `site_settings` to a global.

## Design

**Release truth.** `forge-release.ts` keeps `CURRENT_FORGE_VERSION = '0.13.4'` (npm `latest`). A new `FORGE_CHANNELS` record states `rcPublished: false` and `agentPublished: false`, verified 2026-10-14. All
"available in RC" / install-command copy derives from it: while `false`, the site says "Coming with the 1.0 release candidate" and renders no install command for `@forge-cms/agent`. Package cards carry an
`availability` (`stable` | `experimental`) and a per-package version label (`agent` shows the channel, never `0.13.4`).

**Homepage.** Hero badge: "Open source · 1.0 candidate · v0.13.4 stable" (core is not labelled experimental). New sections, in reading order: capability overview grouped by value (Content / Backend / Angular /
Operations), localization (ES/EN example, top-level `text`/`textarea` only), client-site flow (developer owns UI, client uses Forge admin, agent tooling secondary), Agent Kit (experimental), Analytics
(experimental), packages (twelve, grouped, `s3` and `agent` present), roadmap (1.0 "Candidate ready"; never "complete"). A shared `Experimental` badge (restrained) marks only Agent Kit and Analytics.

**`/demo` page.** A "What to explore" grid (editor and developer tracks refreshed: drafts, media, ES/EN, Analytics, Agent Kit as dev tooling against the project — not in the runtime).

**Lumea localization dogfood (additive).** A new `notices` collection (`drafts: true`, `locales: ['en','es']`; localized top-level `text`/`textarea` only: `title`, `message`, `linkLabel`; shared `slug`, `linkPath`).
New table, so no D1 scalar→locale reinterpretation. Public read: `GET /api/site/notices/:locale` (`en|es`, anything else 404; the path — not a query string — is the cache key, so the cache stays bounded) via the
Local API with `locale` and `overrideAccess: false, user: null` (drafts stay invisible). The site shell has an accessible EN/ES switcher backed by a `?lang=` query param (no global mutable state). Existing
seeded deployments receive the two seed notices by an idempotent, additive "ensure" step (create only when the collection is empty). Static Lumea UI labels remain English.

**Lumea polish.** Client-ready admin dashboard (bookings, live treatments, drafts, journal, site traffic, quick links) with honest Analytics states; loading/empty/error states reviewed; stale comments reconciled.
`docs/DEMO-FINDINGS.md` gains a current-status table at the top; SSR wording corrected (Forge supports and certifies Analog SSR; Lumea remains an SPA by choice).

**Agent Kit dogfood.** A deterministic test runs the local MCP server (built `packages/agent`) against `apps/demo-aesthetics` over stdio — no LLM, no network — and asserts project detection and an error-free
doctor. `@forge-cms/agent` is never a dependency of the demo runtime or any browser bundle.

## Implementation plan

- [ ] spec + release-truth constants + landing data + tests (`apps/www`)
- [ ] homepage sections (capabilities, localization, client flow, Agent Kit, Analytics, packages, roadmap, nav/footer)
- [ ] `/demo` page
- [ ] Lumea `notices` collection, route, switcher, seed-ensure, tests
- [ ] Lumea admin dashboard + public polish, stale comments, README, DEMO-FINDINGS
- [ ] Agent Kit dogfood test
- [ ] www + demo e2e updates; visual verification at 390/768/1440/1920, light + dark
- [ ] full CI-equivalent gates; STATE.md

## Test plan

Unit: landing-data truth (twelve packages, availability, release channels); demo `notices` localized read, draft privacy, unknown locale. E2E: homepage sections/labels/CTAs, `/demo` explore grid, Lumea EN/ES
switch, dashboard, Analytics states. Agent Kit dogfood against `apps/demo-aesthetics`. Full gates in the PR.

## Acceptance criteria

1. `git diff main -- packages api-baseline .changeset` is empty; public package tarballs unchanged (recorded).
2. Homepage says twelve packages, represents `s3` and `agent`, labels only Agent Kit and Analytics experimental, and shows no install command for unpublished `@forge-cms/agent`.
3. `CURRENT_FORGE_VERSION` remains the stable `latest`; no "1.0 released" wording.
4. Localization example uses only supported shapes. Lumea shows real EN/ES notices; drafts never leak; unknown locale is 404.
5. Analytics shows no fabricated numbers anywhere.
6. Agent Kit dogfood test passes against `apps/demo-aesthetics`.
7. No horizontal overflow at 390/768/1440/1920; keyboard + reduced motion intact; light/dark verified.
8. `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, e2e (www, www prod, demo), coverage, performance, stability, docs:verify green; PR CI green.

## Open questions

None.

## Outcome

Shipped as designed. Website: twelve-package inventory, `FORGE_CHANNELS`-driven availability, capability groups, localization/client-flow/Agent Kit/Analytics sections, `/demo` explore grid. Lumea: additive localized `notices`
(+ idempotent `ensureNotices`), EN/ES switcher via `?lang=`, dashboard polish, stale comments and DEMO-FINDINGS reconciled, Agent Kit dogfood script. Divergences: the Agent Kit doctor flagged the demo's undeclared
`@angular/cdk` admin peer, so it is now declared (3-line lockfile change; version already in the lockfile). No `packages/*` change, no changeset; RC publication not triggered.
