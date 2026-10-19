# 100 — Refine the public website palette and add consent-gated Umami audience measurement

- **Status:** done
- **Author:** Codex, from the maintainer's explicit implementation request
- **Date:** 2026-10-19
- **Branch:** `feat/www-umami-brand-palette`
- **Affected packages/apps:** `apps/www` only; this spec and `docs/STATE.md`. No `packages/*` changes.

## Context / Why

The official site's shared light/dark palette still uses the original pale blue and ink colors. The
maintainer requested a quieter near-neutral palette with subtle violet balance and a privacy-conscious
connection to the existing self-hosted Umami service.

The public tracker endpoint and its installed version/configuration cannot be verified from the current
environment. Umami's documented defaults use SPA history tracking, support domain/query/hash controls,
use IP transiently for location and derive rotating session hashes from browser/network properties. The
AEPD audience-measurement exemption also depends on server-side purpose, reuse, retention, and controller/
processor arrangements. Therefore, analytics must remain disabled until visitors explicitly consent.

## Goal

Refine the shared public site theme without layout changes, and add an opt-in, production-domain-only
Umami integration with a clear privacy notice and footer link.

## Non-goals

- No package/API changes, release/version changes, new analytics events, server proxy or Umami server edits.
- No redesign, layout/typography/spacing changes, or analytics on `/admin`, local, or preview hosts.
- No claim that consent exemption applies until owner verifies controller, processing and retention facts.

## Design

- Keep every site token inside `.forge-public`; use near-neutral violet-balanced light and dark values.
- Load the official `https://umami.andersseen.dev/script.js` only after explicit opt-in and only when the
  browser hostname is exactly `forgecms.dev`. Set the public website ID, `data-domains`, DNT respect,
  query exclusion and hash exclusion. Never set a distinct ID or custom event.
- Let Umami's official History API integration handle Angular SPA route changes; do not call `track()`.
- Store only the visitor's consent choice in local storage. No choice or storage failure means no tracking.
- Add an accessible privacy route and a discreet footer link. Disclose known tracker data flows and flag
  the unverified server retention/controller details rather than inventing them.

## Implementation plan

- [x] Refine semantic light/dark tokens and update related page-level hard-coded theme colors only.
- [x] Add consent-gated tracker loading, exact production host restriction, and focused automated coverage.
- [x] Add a privacy route, accurate notice, and footer link.
- [x] Capture/review both themes at 390, 768, 1440, and 1920px; run website accessibility and E2E checks.
- [x] Run relevant local checks, update `docs/STATE.md`, and record evidence/outstanding owner facts.

## Test plan

- Unit tests cover host/path policy, consent persistence and no tracker load without opt-in.
- Playwright intercepts Umami, checks script configuration, exactly-once SPA pageviews, query/hash removal,
  refusal/failed storage, and no tracking from local test hosts.
- Theme e2e asserts key semantic token values and theme persistence; inspect all requested viewport sizes.
- Build, www lint/typecheck/unit/e2e and repository formatting checks; run applicable repository gates.
- Separate production connectivity check; do not send real pageviews while dashboard access/configuration
  is unverified.

## Acceptance criteria

1. Light and dark public surfaces have cohesive near-neutral backgrounds with accessible text and retained
   violet/cyan accents; admin styles and layout are unaffected.
2. Umami does not load by default, on local/preview/unrelated hosts, or under `/admin`.
3. After explicit consent on `forgecms.dev`, the official tracker loads once with the requested website ID,
   domain restriction, DNT, query exclusion, and hash exclusion. No manual duplicate SPA tracker exists.
4. The privacy notice accurately lists data and does not claim unverified legal exemption or server retention.
5. Deterministic tests do not require the live analytics service and no package/API artifacts change.

## Open owner facts

- The public tracker endpoint did not resolve from this environment; verify deployment endpoint before launch.
- Confirm the site's controller identity/contact, Umami version and configuration, processing location/roles,
  data reuse policy, and database retention/deletion period before considering removal of the consent gate.
- Until those facts are verified, explicit consent is required by the implementation.

## Outcome

Merged as PR #119 (`e7e280c8621bf115042e1b8f3d1d11eb00a2c0c7`). All acceptance criteria and automated checks passed; main CI and the Cloudflare Pages deployment job succeeded. Live DNS checks for the site and analytics endpoint were unavailable from this environment, so production page response and tracker ingestion remain unverified. Consent stays enabled while the listed service/controller/retention facts await owner confirmation.
