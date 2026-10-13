# 091 — Consumer documentation and release dossier

- **Status:** in-progress
- **Author:** agent draft (maintainer-directed, roadmap 0.12 / R04)
- **Date:** 2026-10-13
- **Branch:** `feature/spec-091-consumer-docs-release-dossier`
- **Affected packages/apps:** documentation, `scripts/docs/*`, `docs/examples/*`, CI, `apps/www` (docs content + release constant), the README of every published package (patch changeset)

## Context / Why

R01 certified exact packed artifacts, R02 closed measurable reliability/performance gaps, R03 rehearsed real remote Cloudflare staging and an
isolated restore. The package family is published as `0.13.3`. What is left before release-candidate work (L01) is that a developer who has never
seen this monorepo can understand, install, operate and review ForgeCMS from the documentation alone, and that one authoritative document maps every
1.0 commitment to reproducible evidence. Today several current-facing documents still carry pre-release truth (`packages/api/README.md` says CRUD is not
implemented, `docs/CONTEXT.md` says nothing is published, the website reports `0.13.2`, STATE calls the R03 patch pending, deployment pages say no
remote Cloudflare evidence exists), there is no security reporting path, no support policy, and the quickstarts were never run from an empty directory.

## Goal

A developer starting outside the ForgeCMS monorepo can follow the official documentation to create a server-only CMS or an Angular/Analog CMS with the
reusable admin, using only supported public packages and configuration. Every documented option, default, field, compatibility tuple and deployment
profile matches the frozen 1.0 candidate surface and proven R01–R03 evidence. A release dossier maps every 1.0 commitment to reproducible evidence and
identifies exactly what L01 must seal.

## Non-goals

No new public API, schema field, admin redesign, adapter, deployment provider, GraphQL, CLI, plugin system, email, page builder, Strata expansion or
Angular/Vite upgrade; no feature added because documentation revealed an opportunity; no `1.0.0-rc.*`, no prerelease mode, no dist-tag or tag change,
no package version bump by hand, no L01 work. Historical specs are not rewritten to sound current.

## Design

### Current truth refreshed before editing (2026-10-13)

`main` = `7aa8fa3` (merge of PR #96 "Version Packages"); main CI run `38262008765` ✓ (all required jobs); PR #95 merged (R03 closeout); no open PRs;
`.changeset/` holds only `README.md` + `config.json`; all eleven `@forge-cms/*` at `0.13.3` on npm `latest`; latest GitHub release tag
`@forge-cms/cloudflare@0.13.3` (per-package tags; `v0.13.3` as named by the maintainer is the family release); `CURRENT_FORGE_VERSION` was `0.13.2` (stale).
GitHub Private Vulnerability Reporting is **disabled** on the repository (checked through the API) — the security policy states that honestly; enabling
it is a repository-owner action recorded in the dossier.

### Deliverables

| Area                 | Artefact                                                                                                                                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quickstarts          | Website `/docs/server-quickstart` (server-only) and `/docs/angular-quickstart` (Angular/Analog + admin); sources in `docs/examples/*`, embedded verbatim (`<!-- snippet: -->`)                                                                                                     |
| Executable proof     | `pnpm docs:verify:consumers` — both quickstarts installed from packed tarballs into clean projects (strict peers), strict TS/templates, production build, built server + Chromium                                                                                                  |
| Doc gate             | `pnpm docs:verify` — links (incl. anchors), snippet↔example sync, reference↔`api-baseline`, stale-claim denylist; offline, fast                                                                                                                                                    |
| Reference            | `docs/REFERENCE.md` (every package + subpath, options, defaults, errors, stability), `docs/MATRICES.md` (fields · features · deployment profiles), `docs/SUPPORT.md` (policy + support matrix), `docs/LIMITATIONS.md`, `docs/MIGRATING-TO-1.0.md`, website `/docs/troubleshooting` |
| Policy               | `SECURITY.md`, `docs/SUPPORT.md` (semver, deprecation, supported versions), `CONTRIBUTING.md`                                                                                                                                                                                      |
| Entry points         | `README.md`, `docs/README.md`, `docs/CONTEXT.md`, `docs/QUICKSTART.md`, the eleven package READMEs                                                                                                                                                                                 |
| Evidence             | `docs/1.0-RELEASE-DOSSIER.md` — the L01 handoff                                                                                                                                                                                                                                    |
| Truth reconciliation | `docs/STATE.md`, `docs/ROADMAP.md`, `docs/roadmap/v1/0.12-certification.md`, `apps/www/src/app/forge-release.ts`, deployment/recovery/ops docs                                                                                                                                     |

### Documentation audit

Classification of every current-facing document at the start of R04 (CURRENT · PARTIALLY STALE · STALE/MISLEADING · HISTORICAL — LEAVE UNCHANGED ·
DUPLICATE — CONSOLIDATE/LINK · MISSING) and the action taken.

| Document                                                                                                                                                      | Class              | Finding → action                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                                                                                                                                   | STALE / MISLEADING | Says `0.12.0`/`0.11.0`/"pre-1.0, stability not guaranteed", "not a remote deployment" → rewritten as the product entry point                          |
| `CONTRIBUTING.md`                                                                                                                                             | STALE / MISLEADING | Node `>= 20.19`, `admin placeholder`, incomplete package list, manual `changeset:version` release → rewritten for the CI-driven Version Packages flow |
| `SECURITY.md`                                                                                                                                                 | MISSING            | Created (real mechanism only)                                                                                                                         |
| Support/compat policy                                                                                                                                         | MISSING            | `docs/SUPPORT.md` created                                                                                                                             |
| `CLAUDE.md` / `AGENTS.md`                                                                                                                                     | CURRENT            | Agent guide; `docs:verify` rows added                                                                                                                 |
| `docs/README.md`                                                                                                                                              | STALE              | Package family `0.8.2`, roadmap 0.8 "will publish" → reconciled index                                                                                 |
| `docs/CONTEXT.md`                                                                                                                                             | STALE / MISLEADING | "nothing published", `0.0.0`, no compatibility, drafts/versions/i18n as non-goals, KV planned → rewritten as current product intent                   |
| `docs/STATE.md`                                                                                                                                               | PARTIALLY STALE    | Header calls the R03 patch pending and `0.13.2` current → header reconciled; older paragraphs stay as history                                         |
| `docs/ARCHITECTURE.md`                                                                                                                                        | PARTIALLY STALE    | Package graph/contracts current; deployment evidence sentence predates R03 → corrected, link to STAGING-REHEARSAL                                     |
| `docs/QUICKSTART.md`                                                                                                                                          | STALE / MISLEADING | "`0.0.1` first experimental release", partial Angular → replaced by a short index to the two canonical quickstarts (DUPLICATE — LINK)                 |
| `docs/1.0-PUBLIC-SURFACE.md`                                                                                                                                  | PARTIALLY STALE    | Contract is current; "currently 0.12.x" → reconciled                                                                                                  |
| `docs/SCHEMA-UPGRADES.md`                                                                                                                                     | PARTIALLY STALE    | Lifecycle accurate; evidence line "local D1/R2" lacked the R03 remote layer → linked                                                                  |
| `docs/BACKUP-RESTORE.md`                                                                                                                                      | PARTIALLY STALE    | "No remote D1/R2 rehearsal" → replaced by the R03 result and its limits                                                                               |
| `docs/DEPLOYMENT-HEALTH.md`                                                                                                                                   | CURRENT            | Checked against R03; unchanged except a link                                                                                                          |
| `docs/STAGING-REHEARSAL.md`                                                                                                                                   | CURRENT            | R03 runbook; unchanged                                                                                                                                |
| `docs/DEMO-FINDINGS.md`                                                                                                                                       | HISTORICAL — LEAVE | Chronological record; only two links to deleted demo files turned into plain text so the link gate can pass                                           |
| `docs/ROADMAP.md`, `docs/roadmap/v1/*`                                                                                                                        | PARTIALLY STALE    | R04 closeout at the end (`0.12-certification.md`, ROADMAP, EXECUTION pointers)                                                                        |
| `docs/ROADMAP-LEGACY.md`, `docs/specs/001–090`                                                                                                                | HISTORICAL — LEAVE | Unchanged (spec 090's Outcome gets one dated current-truth note; its recorded evidence is not edited)                                                 |
| Website `introduction`                                                                                                                                        | PARTIALLY STALE    | `0.8.2`, "local evidence, not live Cloudflare" → fixed, links added                                                                                   |
| Website `quickstart`                                                                                                                                          | STALE              | "experimental… not guaranteed" → current preface, links to both quickstarts                                                                           |
| Website `small-project-guide`                                                                                                                                 | PARTIALLY STALE    | Kept as the extended walkthrough; evidence sentence ("not a remote deployment") corrected                                                             |
| Website `deployment`                                                                                                                                          | STALE              | "Remote Cloudflare deployments are not certified" → evidence layers + isolated-staging result                                                         |
| Website `schema-upgrades`, `collections`                                                                                                                      | PARTIALLY STALE    | Version-availability notes ("since 0.8.0") are accurate history; "Where this is going" reconciled with the backup/restore result                      |
| Website `uploads`, `adapters`, `ssr`                                                                                                                          | CURRENT            | Spot-audited against source; cross-links to the new limitation list                                                                                   |
| Website `concepts`, `collections`, `fields`, `hooks`, `local-api`, `rest-api`, `access-control`, `angular-client`, `admin-ui`, `browser-auth`, `machine-auth` | CURRENT            | Audited for the claims R04 re-states; browser-auth logout/session paragraph tightened (session version) and metadata guarantee added                  |
| Website server-only quickstart                                                                                                                                | MISSING            | `/docs/server-quickstart` created                                                                                                                     |
| Website Angular/Analog quickstart                                                                                                                             | MISSING            | `/docs/angular-quickstart` created (the small-project guide stays the long form)                                                                      |
| Website troubleshooting                                                                                                                                       | MISSING            | `/docs/troubleshooting` created                                                                                                                       |
| `packages/api`, `runtime`, `auth`, `storage`, `core`, `testing` READMEs                                                                                       | STALE / MISLEADING | "Future…", "Early design phase", "No real CRUD runtime" → rewritten from the real exports                                                             |
| `packages/angular`, `admin`, `db`, `s3`, `cloudflare` READMEs                                                                                                 | PARTIALLY STALE    | Current content; support-matrix/stability/links aligned                                                                                               |
| API/options reference, field/feature/profile matrices, support matrix, limitations, 0.x→1.0 guide, release dossier                                            | MISSING            | Created                                                                                                                                               |

### Quickstart examples

`docs/examples/server-quickstart` and `docs/examples/analog-quickstart` are real source trees. The website pages embed them with
`<!-- snippet: docs/examples/<path> -->` blocks; `pnpm docs:verify` fails when a block drifts, and `pnpm docs:verify:consumers` builds exactly those
files from the packed tarballs (the R01 tarball set when `FORGE_CERT_ARTIFACTS` is set, otherwise packed once through the same
`scripts/certification/artifacts.mjs`). No second packing framework exists. The Angular quickstart uses the development adapters on purpose (data resets
on restart); the durable profiles are the deployment guide, certified separately by R01/R03.

### Truth rules for the new documents

Supported range ≠ tested versions; "certified" means a named CI/rehearsal gate ran against exact artifacts; R03 is evidence for the framework/profile on
isolated staging, never a production guarantee or SLA; Garage `v2.4.1` is the only certified S3 service; Cloudflare Analytics is experimental; Strata is
consumer dogfood, not Forge API; the previously-reported metadata exposure (R03-F1) leaked field **names** only, never values, and is fixed in `0.13.3`.

## Implementation plan

- [x] Refresh truth (git, CI, npm, releases, changesets, website version) and branch
- [x] Spec 091 with the documentation audit
- [x] Executable quickstart sources + `docs:verify:consumers` (server + Angular/Analog, packed tarballs, strict TS/templates, built server, Chromium)
- [x] `docs:verify` (links with anchors, snippets, reference↔baseline, stale denylist) + unit tests
- [ ] Package READMEs, root README, CONTEXT, docs index, CONTRIBUTING, SECURITY, QUICKSTART
- [ ] Reference, matrices, support, limitations, migration guide, troubleshooting, quickstart pages
- [ ] Stale-claim fixes: deployment, backup/restore, architecture, schema upgrades, website pages, forge-release
- [ ] Release dossier; R03 caveat disposition; issue classification
- [ ] Changeset (patch), CI wiring, STATE/ROADMAP/0.12 closeout, Outcome
- [ ] Full local gate run; PR

## Test plan

`pnpm docs:verify` (+ `scripts/docs-verify.test.mjs`, which proves each check fails on a seeded defect), `pnpm docs:verify:consumers` (both quickstarts from packed
tarballs), the whole repository gate and certification set listed in the Outcome.

## Acceptance criteria

The 71 criteria of the R04 packet (definition of done). Mechanical ones: `pnpm docs:verify` and `pnpm docs:verify:consumers` pass; `pnpm check:api` shows no
drift; `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; a patch changeset exists for the touched published packages; no RC version, tag or
dist-tag exists; roadmap 0.12 is marked complete and ForgeCMS is not marked released as 1.0.

## Open questions

None.

## Outcome

_Filled at completion (see below)._
