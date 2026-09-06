# ROADMAP — A small, dependable ForgeCMS 1.0

> Baseline: **2026-09-06**, commit `d518878`, public package manifests **0.4.0**.
> Status: **proposed delivery plan; this document does not authorize implementation**.
> Replaces the sequencing in [ROADMAP-LEGACY.md](ROADMAP-LEGACY.md), preserved as history.
> [STATE.md](STATE.md) describes implementation; this document describes future release gates.

## Product decision

ForgeCMS 1.0 should let another project install the libraries, define content, authenticate users,
enforce access, edit and publish content, persist it, and upgrade safely. Its advantage is a typed
server API and an Angular consumption path. It does not need feature parity with Payload.

The existing implementation already contains more capabilities than a minimum useful CMS needs.
**Stop expanding the feature catalogue until the existing public surface has credible guarantees.**
Prioritize authorization consistency, data integrity, compatibility and consumer verification.
More components, a plugin ecosystem and a CLI are not release prerequisites.

“Stable” means documented behavior, compatibility rules and repeatable evidence. It cannot mean
zero possible defects. The acceptance gates below replace that impossible promise.

## Reading and execution order

| Document                                      | Purpose                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| [Assessment](roadmap/v1/AUDIT.md)             | Strengths, observed defects, unverified risks and evidence                |
| [Execution handbook](roadmap/v1/EXECUTION.md) | Responsibility boundaries, small-model packets, reviews and release rules |
| [Quality contract](roadmap/v1/QUALITY.md)     | Unit, adapter, HTTP, browser, artifact and upgrade matrices               |
| Release briefs below                          | Inputs, outputs, dependencies, tests, exclusions and exit gates           |

Documentation remains in English per CONVENTIONS.md. Packet IDs below are planning IDs, not spec
numbers. Allocate the next free `docs/specs/NNN-*` when preparing a task; do not reuse historical
spec IDs 019–056 for unrelated work. All briefs are proposed, with implementation not started.

## What 1.0 promises

| Surface            | Required guarantee                                                                             | Deliberate boundary                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Schema / Local API | Strict validation, documented inference, CRUD/count/findOne, defaults, hooks, access           | No new field kinds or generic workflow engine                                          |
| HTTP               | Routes, queries, errors, metadata, limits and access are documented and tested                 | REST only; preserve `/api/v1`, partial `PUT`, canonical envelopes                      |
| Database           | InMemory, libSQL and D1 agree on supported behavior; unsupported operations fail explicitly    | InMemory is for dev/tests; no new database engines or generic distributed transactions |
| Auth               | Safe provisioning, current permissions, session invalidation, scoped API keys and CSRF         | No mandatory email service, OAuth marketplace or refresh-token subsystem               |
| Content lifecycle  | Existing drafts, globals, versions, preview, localization and relations have tested boundaries | No new visual history/preview product; reject unsafe unsupported configurations        |
| Storage            | R2 lifecycle and file access are reliable                                                      | Portable/libSQL content supported; durable portable uploads outside 1.0                |
| Angular            | Configurable endpoints, structured errors, honest wire types and request-scoped SSR            | No server credentials/code in browser bundles; peer versions backed by tests           |
| Admin              | Existing content/users workflows are usable, accessible and reusable                           | No dashboard rewrite, bulk actions, saved views or new WYSIWYG                         |
| Maintenance        | Packed artifacts work; schema evolution, backup and recovery have a tested path                | No CLI required; no automatic rollback promise for arbitrary destructive migrations    |

Inventory **all** current exports. Before the 0.5 contract closes, classify each as retained and
certified, deprecated with migration, removed before 1.0 with migration, or moved to a separate
experimental entry point. Default to retaining useful APIs. An exported root API cannot silently
be called experimental while the package promises stability. Experimental status never excuses
unauthorized access or data loss.

## Release sequence

Minor means the middle number in `0.x.y`; **0.10 follows 0.9**. These are proposed versions, not
claims of published releases. Keep the ten public packages in the existing Changesets fixed group.
Family bumps do not imply every package gained functionality. The private root `0.0.0` is unrelated.

| Release                                    | One release outcome                                                 | Packets                                    | Dependency              |
| ------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------ | ----------------------- |
| 0.4.x                                      | Record completed spec 056 and patch urgent regressions              | Release bookkeeping; no new feature bundle | Record current baseline |
| [0.5](roadmap/v1/0.5-contract-baseline.md) | One accurate contract and visible test baseline                     | B01–B04                                    | 0.4.x baseline          |
| [0.6](roadmap/v1/0.6-authorization.md)     | All content paths enforce the same access policy                    | A01–A04                                    | B01–B03                 |
| [0.7](roadmap/v1/0.7-auth-lifecycle.md)    | Users/sessions/provisioning stay safe across requests and instances | H01–H04                                    | 0.6                     |
| [0.8](roadmap/v1/0.8-data-integrity.md)    | Content mutations have defined failure/concurrency semantics        | D01–D04                                    | 0.7                     |
| [0.9](roadmap/v1/0.9-schema-upgrades.md)   | Consumers can evolve and recover persisted data                     | M01–M03                                    | 0.8                     |
| [0.10](roadmap/v1/0.10-angular-client.md)  | A configurable, typed and compatible browser SDK                    | C01–C03                                    | 0.9                     |
| [0.11](roadmap/v1/0.11-ssr.md)             | Public-content SSR/hydration without crossing user boundaries       | S01–S03                                    | 0.10                    |
| [0.12](roadmap/v1/0.12-admin.md)           | Existing editorial workflows work reliably in consumers             | U01–U03                                    | 0.11                    |
| [0.13](roadmap/v1/0.13-certification.md)   | Candidate proven outside workspace shortcuts                        | R01–R04                                    | All earlier gates       |
| [1.0 RC → 1.0](roadmap/v1/1.0-release.md)  | A documented compatibility commitment backed by evidence            | L01–L03                                    | 0.13 dossier            |

These nine minors deliberately separate permissions, session lifecycle, data integrity, upgrades,
SDK and SSR. Do not combine them into one “production hardening” release. Each packet is a separate
PR; split oversized packets into suffixed children before implementation. A minor is an acceptance
milestone, not one large branch.

Security fixes do not wait for the assigned minor. A confirmed unauthorized read/write gets an
immediate regression patch or explicit safe restriction in the current supported 0.x line. The
planned minor still completes the full design/audit. Never preserve an insecure accidental behavior
as a compatibility guarantee.

## Priority and scope control

1. **Blockers:** unauthorized access, stale privileged sessions, data loss, broken artifacts,
   undocumented incompatibilities and failing required tests.
2. **Required value:** typed configurable client, public-content SSR, reliable existing admin,
   install/upgrade guides and certified support profiles.
3. **After 1.0:** portable durable storage, email/reset flows, CLI, config/plugins,
   `@forge-cms/analog` as a new package, bulk actions, saved filters, visual history/preview,
   richer editors, new providers and databases.

The portable storage gap is real. The bounded promise is “libSQL for persisted content, R2 for
durable uploads,” not “every feature on every backend.” If a committed consumer needs portable
uploads, add a dedicated minor with storage contracts and lifecycle tests; never hide it in SDK work.

Do not remove globals/versions/localization just to shrink the test matrix: they are already
public. Enumerate combinations, repair safety and reject unsupported options. Actual removals
require a maintainer decision and a migration. No new components are necessary just to label 1.0.

## Definition of 1.0 readiness

- Every retained export, route and option has an owner, contract, compatibility classification
  and linked executable evidence.
- All promised behavior has success, invalid-input and relevant denied/failure tests. Coverage
  includes untested source; browser tests prove journeys rather than every internal branch.
- All [quality gates](roadmap/v1/QUALITY.md) pass on the candidate commit. Release-required suites
  cannot be omitted while publishing still proceeds.
- No unresolved critical/high access, credential, corruption or data-loss findings. Lower-severity
  accepted issues record effect, owner, workaround and follow-up; blockers cannot be waived.
- A clean consumer installs packed candidates, builds for production, completes the product journey,
  upgrades previous-version data and restores a backup without workspace imports.
- D1/R2 and libSQL are proven in their stated profiles. Authorized remote staging evidence is
  separate from local workerd evidence.
- RC observation, support policy, recovery procedure, package metadata and docs are complete.

No calendar deadline is inferred. Measure a completed packet per discipline before forecasting.
Ship on evidence, not a date. If a gate grows, split its implementation; do not drop its guarantee.

## Mapping the old roadmap

| Legacy theme                                                  | New treatment                                                     |
| ------------------------------------------------------------- | ----------------------------------------------------------------- |
| Local API, hooks, fields, globals, versions, locales, queries | Already implemented; certify in 0.5–0.9, do not recreate          |
| Browser auth / users admin                                    | Already implemented; lifecycle in 0.7, interaction QA in 0.12     |
| 036 signals / SSR                                             | Signals exist; SDK in 0.10, SSR in 0.11                           |
| 038 document types                                            | Server half exists; browser wire typing in 0.10                   |
| 031 migrations / CLI                                          | Essential upgrade safety in 0.9; optional CLI after 1.0           |
| 029 email, 030 plugins, 037 Analog package                    | After 1.0 unless separately justified                             |
| 032–035 richer admin                                          | Certify existing workflows in 0.12; new product surfaces deferred |

The legacy file is historical context, not a second active backlog. Update this index and the
relevant brief for scope decisions; update STATE only with facts about implemented work.
