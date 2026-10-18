# 099 — Publish the ForgeCMS 2.0 product roadmap

- **Status:** done
- **Author:** agent
- **Date:** 2026-10-18
- **Branch:** main (workspace git metadata is read-only)
- **Affected packages/apps:** documentation; `apps/www`

## Context / Why

ForgeCMS 1.0.0 is published and the repository needs a clear, evidence-based product direction for its next major milestone. The homepage still presents the historical 0.1–1.0 delivery journey, which is no longer the roadmap users need to find.

## Goal

Publish a canonical, status-accurate V2 roadmap in project documentation and the existing Analog documentation and homepage flows.

## Non-goals

- Implementing any V2 product milestone.
- Publishing packages, deploying the website, changing package versions, or merging a PR.
- Committing to GraphQL, new database engines, enterprise SSO, feature parity, a page builder, or a marketplace.

## Design

`docs/roadmap/v2/milestones.json` is the canonical ordered inventory consumed by the homepage and checked against this contract and the public Markdown page. The four roadmap documents describe the vision, commitments, milestone details, and cross-cutting quality bar. The public `/docs/roadmap` article is rendered through Analog's existing content pipeline and grouped under Project in the docs sidebar. The homepage presents 1.0 as shipped and V2-01 as Next; all other V2 milestones are Planned until repository evidence supports another status.

## Implementation plan

- [x] Record the canonical V2 inventory and product contract under `docs/roadmap/v2/`.
- [x] Publish `/docs/roadmap`, link it from docs intro, root docs index, README and footer; retain V1 history.
- [x] Adapt the homepage summary and Docs sidebar order; add consistency and user-visible regression coverage.
- [x] Update docs verification and current-state closeout; run requested focused and repository checks.

## Test plan

- `pnpm --filter @forge-cms/www test`
- `pnpm docs:verify`
- `pnpm --filter @forge-cms/www typecheck`
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
- Website Playwright checks for roadmap page, navigation, metadata, viewport overflow and production sitemap where supported.

## Acceptance criteria

1. Ten unique, ordered V2 IDs have accurate titles and statuses in one canonical inventory; internal and public representations are checked for drift.
2. Four internal roadmap documents and a public English Markdown roadmap page describe the stated scope and exclusions without claiming planned features are shipped.
3. `/docs/roadmap` is linked from docs navigation/introduction and the footer; the homepage shows the shipped 1.0 baseline, all ten V2 milestones, accurate status labels and a full-roadmap link.
4. Historical V1 roadmap documentation remains available and `docs/ROADMAP.md` points to the V2 roadmap without rewriting history.
5. Verification results and environmental limitations are recorded honestly; this spec is marked done only if its acceptance criteria are met.

## Open questions

None.

## Outcome

Published the canonical V2 roadmap and public website summary, and corrected current-facing 1.0 docs from candidate to stable wording; all five acceptance criteria passed. `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm docs:verify`, `pnpm e2e:www` (66 tests), and `pnpm e2e:www:prod` (16 tests) passed. The first E2E attempts hit sandbox file-watcher, Wrangler log-write, and loopback restrictions; reruns passed with test-only escalation. No package/runtime changes, changeset, publish, deploy, or merge.
