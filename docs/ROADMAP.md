# ROADMAP — A small, dependable ForgeCMS 1.0

> Baseline verified **2026-09-07**: current `main` **`28ff76c`**; latest public GitHub release
> [v0.4.0](https://github.com/Andersseen/ForgeCMS/releases/tag/v0.4.0) (2026-09-03);
> all ten public package manifests **0.4.0**. Latest completed spec: **056**.
> Status: **proposed delivery plan; not implementation or publication authorization**.
> [STATE.md](STATE.md) records implementation. [ROADMAP-LEGACY.md](ROADMAP-LEGACY.md) preserves history.

## Product direction

ForgeCMS is a TypeScript-first, code-first headless CMS for small and medium personal/client projects,
with excellent Angular/Analog.js consumption, Cloudflare-first infrastructure, reusable Angular admin
and a supported portable profile. The maintainer should be able to use it without rebuilding half a
CMS. Angular, Analog, signals, typed content and safe SSR are the strategic differentiator. Feature
parity with Payload, Strapi or Directus is not the goal.

The product hierarchy is:

1. Trustworthy CMS fundamentals.
2. Angular/Analog developer experience.
3. Cloudflare-native quality: D1, R2, Workers/Pages and Web Crypto.
4. Credible open-source portability: libSQL, one S3-compatible adapter and a tested standard runtime.
5. A professional reusable Angular admin.
6. Ecosystem expansion later.

**Cloudflare-first with a supported portable profile** means Cloudflare is preferred and best
supported, not mandatory. D1 + libSQL and R2 + one S3-compatible adapter are enough before 1.0.
This is neither a generic backend framework nor an enterprise CMS feature checklist.

> ForgeCMS 1.0 is a dependable, typed, code-first CMS for Angular/Analog applications. A developer
> defines content and users in TypeScript, uses secure auth/access control and the reusable Angular
> admin, runs primarily on Cloudflare D1/R2 or a credible portable libSQL/S3 stack, consumes typed
> content with safe SSR/public hydration, evolves persisted schemas through a documented upgrade
> path, and relies on the published package contracts.

## Start from what already works

Spec 055 demonstrated a useful small project, including real local D1 and libSQL lifecycle tests,
browser auth/admin journeys and packed-consumer verification. The foundation includes typed Local
API, schema DSL, hooks, validation, row/field access, machine API keys, PBKDF2 users, HttpOnly sessions,
signup/signin/logout/me, CSRF and last-admin checks. Relations, integrity rules, compound indexes,
nested queries, findOne, multi-sort, drafts, versions, globals, localization, live preview and blocks
are already exposed. Signals/session/guard and reusable content/users/auth admin also exist.

Spec 056 is **done**, with safe auth redirects, improved dialogs/empty states, removal of decorative
admin chrome and external avatars, clearer beginner docs/homepage, and demo navigation/E2E polish.
Commits since its implementation added planning documentation only. Do not schedule another redesign.

Remaining gaps are specific: durable storage is R2 only; no S3 adapter exists. All three apps still
configure `ssr: false`. Angular auth paths/configuration and browser schema inference need work.
Existing advanced content/auth paths need more consistent access and concurrency guarantees.
See [AUDIT.md](roadmap/v1/AUDIT.md) for preserved evidence and unproven interleavings.

## Read only what the task needs

| Document                             | Purpose                                                              |
| ------------------------------------ | -------------------------------------------------------------------- |
| [AUDIT](roadmap/v1/AUDIT.md)         | Existing strengths, observed paths, risks and evidence limits        |
| [EXECUTION](roadmap/v1/EXECUTION.md) | Prepare one bounded responsibility, review and merge coherently      |
| [QUALITY](roadmap/v1/QUALITY.md)     | Relevant tests, durable profiles, compatibility and release evidence |
| Release brief below                  | Goal, scope, packets, dependencies, acceptance and gate              |

Read the assigned brief and its referenced findings/contracts, then prepare the necessary spec under
[SDD.md](SDD.md). Packet IDs are planning references, not historical spec numbers. Allocate the next
free spec number; do not reuse 019–056. This roadmap does not approve future implementation specs.

## Release sequence

Minor versions communicate a coherent capability or guarantee, not line count. Several packets and
PRs may belong to a minor. **Packet ≠ release; packet ≠ necessarily a public feature.** One PR per
coherent implementation is preferred; split only oversized or independently risky responsibilities.
Do not build an entire minor on one giant branch or force a separate PR for each test/file change.

| Release                                      | Product / engineering outcome                          | Packets                        | Release prerequisite                    |
| -------------------------------------------- | ------------------------------------------------------ | ------------------------------ | --------------------------------------- |
| 0.4.x                                        | Patch confirmed defects; spec 056 is already complete  | Current-line fixes/bookkeeping | Verified baseline                       |
| [0.5](roadmap/v1/0.5-contract-baseline.md)   | Contract + access foundation                           | B01–B04, A01–A04               | 0.4.x baseline                          |
| [0.6](roadmap/v1/0.6-auth-data-integrity.md) | Safe auth and data lifecycle under mutation/failure    | H01–H04, D01–D04               | 0.5 contracts/access                    |
| [0.7](roadmap/v1/0.7-schema-upgrades.md)     | Schema upgrade, backup and recovery path               | M01–M03                        | 0.6 schema decisions                    |
| [0.8](roadmap/v1/0.8-angular-client.md)      | First-class typed Angular client and DX                | C01–C03                        | Server contracts; 0.7 upgrade readiness |
| [0.9](roadmap/v1/0.9-ssr.md)                 | Analog Local API + safe public SSR/hydration           | S01–S03                        | 0.8 transport/types                     |
| [0.10](roadmap/v1/0.10-portable-storage.md)  | Complete D1/R2 and libSQL/S3 deployment profiles       | P01–P03                        | Storage/access/upgrades; 0.9 consumer   |
| [0.11](roadmap/v1/0.11-admin.md)             | Existing admin is reliable, accessible and reusable    | U01–U03                        | SDK, SSR and durable profiles           |
| [0.12](roadmap/v1/0.12-certification.md)     | Final artifact/profile certification + RC preparation  | R01–R04, L01 preparation       | Prior outcomes and U03 surface freeze   |
| [1.0 RC → 1.0](roadmap/v1/1.0-release.md)    | Defect-only observation, then compatibility commitment | L01 candidate, L02–L03         | Accepted candidate evidence             |

This is eight meaningful pre-1.0 checkpoints instead of nine, while adding durable portable files.
0.12 is a readiness checkpoint: do not publish an extra minor solely to say certification finished
if no product/API change requires it. `0.10` follows `0.9`; numbers are proposed, not shipped claims.
Keep the existing Changesets fixed family; a future S3 package's exact placement/group membership
is a scoped design decision. The private root `0.0.0` is unrelated to public versions.

Release order is not a blanket dependency on unrelated packets. Client design and focused admin/DX
fixes can proceed once their actual predecessor contracts are settled. Security patches bypass the
minor schedule: confirmed unauthorized reads/writes, passwordHash/internal-field leakage, stale
privilege, role escalation, corruption and broken upgrades get immediate regressions and fixes or
explicit safe restrictions. No known critical/high safety defect is waived to advance the schedule.
Bug/security/UI/performance/test/docs corrections are patches; intentional pre-1.0 contract changes
need a meaningful minor and migration notes.

## What 1.0 promises

| Surface            | Required guarantee                                                                                                                       | Boundary                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Schema / Local API | Strict validation, inference, CRUD/count/findOne, defaults, hooks and access                                                             | No new field kinds or workflow engine                                                                                                 |
| HTTP               | Stable routes, query/error/metadata/limit behavior and canonical envelopes                                                               | REST; preserve `/api/v1`, partial `PUT`, `{ data, meta }` / `{ data }` / errors / `204`; inventory exact nested error and auth shapes |
| Database           | D1/libSQL supported semantics agree; InMemory contracts for development/tests                                                            | No Postgres, MongoDB, database marketplace or generic distributed transactions                                                        |
| Auth               | Safe admin bootstrap/user creation, opt-in signup, signin/session/logout, roles/password changes, current permissions, API keys and CSRF | No mandatory email/password-reset service, OAuth, MFA, passkeys or magic links                                                        |
| Content lifecycle  | Certify existing drafts, globals, versions, preview, localization, relations and blocks                                                  | Explicit supported combinations; fix unsafe behavior rather than remove features                                                      |
| Storage            | Durable R2 and one S3-compatible StorageAdapter; upload/access/cleanup lifecycle                                                         | Basic put/get/delete/list/public URL; no direct/presigned uploads, CDN abstraction or image pipeline                                  |
| Angular / Analog   | Configurable content/auth transport, structured errors, schema-aware wire types, reliable signals and safe SSR/public hydration          | No browser credentials/server hooks or cross-request identity/cache leakage; no automatic Analog package                              |
| Admin              | Existing content/users/auth workflows accessible and reusable under custom mount paths                                                   | No redesign, bulk actions, saved filters or new WYSIWYG                                                                               |
| Maintenance        | Packed artifacts, tested peers, schema evolution and backup/recovery                                                                     | No CLI required or automatic rollback promise for arbitrary destructive migrations                                                    |

Inventory every public export before the 0.5 contract closes. Retain useful APIs by default and
record behavior, supported combinations and evidence gaps. A specific maintainer decision and
migration path are required for actual removal/deprecation or movement to an experimental entry
point. Calling an API experimental never excuses unauthorized access or data loss.

## DX and evidence throughout delivery

The acceptance journey is: **install packages → define collections/users → configure auth → choose
D1/R2 or libSQL/S3 → mount runtime/auth routes → bootstrap admin → mount Angular admin → sign in →
manage users/content/files → consume typed Angular/Analog content → deploy → upgrade/recover**.
A developer must complete it through public packages and documented host configuration without
understanding private Forge internals. Certify existing steps now and extend the journey as SDK,
SSR, upgrades and portable storage land; do not defer all guides and usability checks to R04.

- `apps/tiny-project`: external-style setup/auth/content/admin and D1/libSQL parity baseline; extend
  or pair with a minimal packed consumer for files/production SSR.
- `apps/www`: package/admin integration and beginner documentation verification.
- `apps/demo-aesthetics`: real-world Local API consumption, public UX and regression dogfooding.

These are validation surfaces, not independent core features or redesign milestones. Use recorded
consumer evidence honestly: local backend tests, dev-server browser tests, packed builds and remote
deployment verification prove different things.

1.0 requires every retained contract linked to success, invalid-input and relevant denied/failure
evidence; all applicable quality gates on candidate artifacts; no unresolved critical/high access,
credential or data-integrity defects; and clean consumers proving both durable profiles, peers,
SSR/admin, upgrade and restored backups. Lower-severity accepted issues record impact, workaround
and follow-up. Local workerd results do not stand in for authorized isolated staging evidence.

Use an RC observation period with real use in maintained consumers and multiple clean certification
runs. Investigate flakiness and rerun affected/downstream validation after material auth/data/API
fixes. Evidence matters more than elapsed days; no universal seven-day or three-run rule. The
maintainer may choose a candidate-specific observation period during preparation. No date is inferred.

## Before → after and historical mapping

| Previous v1 plan                     | Revised treatment                                                  |
| ------------------------------------ | ------------------------------------------------------------------ |
| 0.5 baseline + 0.6 authorization     | 0.5 contract/access foundation; retain B/A packets                 |
| 0.7 auth + 0.8 data integrity        | 0.6 lifecycle hardening; retain H/D responsibilities               |
| 0.9 upgrades                         | 0.7 upgrades, backup/recovery; no large CLI                        |
| 0.10 Angular / 0.11 SSR              | 0.8 Angular / 0.9 SSR; central outcomes before final certification |
| Portable files after 1.0             | 0.10 bounded S3 storage and complete deployment profiles           |
| 0.12 admin                           | 0.11 certification of existing admin, not a rebuild                |
| 0.13 certification + 1.0 preparation | 0.12 certification/RC preparation, then RC → defect fixes → 1.0    |

Legacy Local API/hooks/fields/globals/versions/locales/query work is implemented, not a second
backlog. Legacy 036 signals exist (reliability in C03; SSR in S01–S03), 038 server types exist
(browser projections in C02), and 031's migration need remains M01–M03 without requiring a CLI.
Legacy richer-admin ideas are deferred. Historical specs and ROADMAP-LEGACY stay intact; the earlier
v1 structure is also available in Git history at `28ff76c`.

## After 1.0

Keep demand-driven ideas concise: email/password recovery, OAuth/social auth, plugins, CLI/scaffolding,
additional DB adapters, direct/presigned uploads, advanced media, bulk actions, saved views, custom
admin widgets, visual version history, scheduled publishing and richer workflows. A dedicated Analog
package is a later decision only if repeated consumer integration justifies it. None blocks 1.0;
organizations, teams, billing, enterprise identity, GraphQL and analytics are not pre-1.0 targets.
(Spec 057 added an experimental, opt-in Cloudflare Analytics Engine module outside this sequence at
the maintainer's explicit request — it is not a 1.0 commitment and does not change this list.)

Exact S3 package/API and tested provider matrix, session/atomicity design, migration signatures,
peer/runtime ranges and candidate observation policy remain decisions for their scoped specs.
They are not reasons to postpone the product commitments above or implement them in this docs task.
