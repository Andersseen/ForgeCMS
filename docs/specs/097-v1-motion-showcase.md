# 097 — ForgeCMS 1.0 motion showcase and release-ready website

- **Status:** done (pending maintainer review)
- **Author:** agent draft (maintainer-requested final pre-RC website packet)
- **Date:** 2026-10-15
- **Branch:** `feature/spec-097-v1-motion-showcase`
- **Affected packages/apps:** `apps/www` only (homepage components, styles, unit + e2e tests). **No `packages/*`, `api-baseline/*`, version or changeset change.**

## Context / Why

Main `2195275` (PR #102, spec 096) carries the prepared, certified, **unpublished** candidate `1.0.0-rc.2`; npm `latest` is `0.13.4` on the eleven stable packages and `@forge-cms/agent` is absent (E404). Main CI
`38702979083` is fully green (checks, certify, reliability · coverage · performance, both Pages deploys). The homepage (spec 094) is accurate but reads as a sequence of similar text-plus-panel sections; it explains
the product in prose where a visual would do it better, and the Agent Kit copy predates the one-command `forge-cms-agent init` (spec 096).

## Goal

The ForgeCMS official website visually communicates why Forge exists and what a real developer/client workflow looks like through polished Angular-native interactive sections, while preserving the existing
product identity, accessibility, performance and exact release truth. The implementation dogfoods Angular Movement and changes no public ForgeCMS package artifact.

## Non-goals

No new Forge package API, CMS, Agent Kit or Analytics capability; no page builder; no Lumea architecture migration; no SSR migration; no design-system replacement; no new animation framework (no GSAP, Framer
Motion, Motion One, Anime.js); no copied Hover/React source, text, CSS or SVG; no WebGL/Three.js/canvas/video; no RC publication; no package version bump; no change to `CURRENT_FORGE_VERSION` semantics.

## Design

**Kept:** palette and tokens, typography, header/footer, hero copy and composition, product showcase, Volt UI, Lumen Icons.

**New page rhythm** (high-attention interaction alternates with quiet content):
Hero + showcase → **Forge story** (sticky) → **Capability bento** (+ the compact 1.0 surface list, `#architecture`) → **Developer ↔ Client swap** → Localization → **Agent Kit terminal** → **Analytics dashboard** →
Lumea proof → Packages → Release status → Footer.

1. **Forge story** (`#how-it-works`): five stages — Schema, Runtime, Angular, Admin, Deploy. Each stage is a real `<li>` with heading, one sentence and its visual, in reading order. At `lg+` a sticky stage index
   (bounded by the section, below the header) shows the active stage; inactive stages recede (opacity/scale via `moveVariants`). Active stage = the step crossing the viewport's centre line, from one
   `IntersectionObserver` (state only, no scroll interception). Below `lg` it is a plain stacked list; no step is ever dimmed.
2. **Capability bento** (`#capabilities`): four arguments with different spans — Angular native (wide), Client ready (tall), Deploy your way, Agent ready (experimental). Staggered reveal, `lift` on hover, and the
   same emphasis on `:focus-within`. The four-group 1.0 capability list follows as quiet text (keeps `#architecture`); the old Local API panel is folded into story stage 2.
3. **Developer ↔ Client** (`#client-site`): Volt tabs switch three pairs — Model (schema → admin form), Build (your components → their admin), Publish (client publishes a draft → your site renders it). In
   Publish the columns swap order (client first). Role lists stay visible below; "not a page builder" stated once.
4. **Localization**: an editor-like panel with an ES/EN switch (real buttons, `aria-pressed`) and a per-locale values grid that is always visible; shared fields are tagged "Shared". Only top-level
   `text`/`textarea` are localized; the 1.0 limits line stays.
5. **Agent Kit** (experimental): terminal story — `pnpm exec forge-cms-agent init` → MCP configured, eight skills, version-matched docs, doctor → developer intent → three read-only consultations → "your agent edits
   with its own tools; you review". Labelled illustrative and **candidate workflow**: while `FORGE_CHANNELS.agentPublished` is `false` the page says the package is not on npm yet and renders no install command.
6. **Analytics** (experimental): compact dashboard preview — range control (24h/7d/30d/90d), pageviews + change vs previous period, timeline bars, top pages, referrers, countries — all deterministic illustrative
   numbers under a visible "Illustrative preview · not live data" label. Privacy guarantees as a compact chip row. No visitors/sessions/funnels/events/heatmaps/revenue.
7. **Release status**: the roadmap section gains a three-step status (candidate certified ✓ → public RC next → `1.0.0` after validation) derived from `FORGE_CHANNELS`.

**Motion** (Angular Movement 1.2.0 only): `moveInView` + `moveStagger` (reveals), `moveVariants`/`moveVariant` (story recede/enter, ES/EN), `[move]` (tab and range swaps), `moveWhileHover="lift"` (bento cards).
Reduced motion: Movement jumps to end states itself; the dimmed "idle" variant is not used under reduced motion, so every stage is fully legible. No wheel/touch listeners, no `preventDefault`, no snap.

## Acceptance criteria

- [x] `git diff 2195275 -- packages api-baseline` is empty; no changeset; manifests stay `1.0.0-rc.2`.
- [x] Story: five stages in DOM order; active stage changes predictably (unit-tested state function); stacked flow below `lg`; readable under reduced motion.
- [x] Bento with four unequal cards; swap section with three states incl. a column swap; localization ES/EN switch + always-visible values; Agent Kit terminal reflecting `init`; Analytics preview labelled illustrative.
- [x] Twelve packages; `s3` present; stable `v0.13.4`; agent never "stable"; unpublished RC/agent never presented as installable; no `1.0.0` released claim.
- [x] Light/dark and 390/768/1440/1920 reviewed; no horizontal overflow; keyboard focus visible.
- [x] Unit + www e2e + production e2e + full quality matrix + `release:certify` green.

## Test plan

Unit (`apps/www`, Vitest): story active-step selection, swap/analytics/locale data truth (no unsupported metric or field shape, illustrative label, deterministic ranges), agent init copy vs channel truth.
E2E (`e2e/landing.spec.ts`): desktop story scroll reaches the final stage; mobile story is a plain flow without overflow; reduced motion leaves every stage readable; dark mode sections readable; CTAs resolve.
Existing production e2e (`e2e-prod`) covers console, overflow/clipping at four widths and links.

## Outcome

_Filled at close-out._
