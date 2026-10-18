# ForgeCMS 2.0 milestones

The inventory below is ordered by dependency and product value, not by release number or date. IDs, titles, summaries, and statuses are owned by [milestones.json](milestones.json), which the public site consumes and `pnpm docs:verify` checks against this document and `/docs/roadmap`.

## V2-01 — Foundation, Security & Release Governance

- **User problem and outcome:** Teams need confidence that the published foundation and its release process are trustworthy and accessible.
- **Existing foundation:** 1.0.0 is published; the release dossier records a successful publication run, but also says post-publication closeout verification is incomplete. Password auth, session versions, throttling hooks, and an admin accessibility baseline exist.
- **Missing work:** Close pending post-1.0 registry/artifact certification; protect `main` and publication authorization; strengthen password hashing and rehash/migration policy; provide secure throttling guidance and certified wiring; improve session revocation policy; close known admin accessibility issues.
- **Scope:** Release evidence, security policy and wiring, auth migration/revocation, and admin accessibility.
- **Non-goals:** Reopening the released 1.0 contract without a separately justified compatibility change; claiming that publication itself proves every closeout check.
- **Dependencies:** None; first V2 checkpoint.
- **Acceptance:** Stable artifacts are verified against recorded source; release actions have enforced authorization and protected-branch checks; no unmitigated critical/high security findings remain; documented auth policies are tested; known admin accessibility issues are closed or explicitly accepted with rationale.
- **Evidence:** Registry/artifact comparison, branch/ruleset and release workflow evidence, security review and tests, auth migration/revocation tests, accessibility scans and keyboard journey.
- **Status:** **Next.** Evidence: [STATE.md](../../STATE.md) records main CI publication and explicitly incomplete post-publication closeout verification. The same record identifies the publication authorization discrepancy and prior admin accessibility gaps.

## V2-02 — Developer Experience & Project Bootstrap

- **User problem and outcome:** New developers need a short, reliable path from an empty project to a working collection and editor.
- **Existing foundation:** Verified server-only and Angular/Analog quickstarts and packed-consumer checks exist.
- **Missing work:** Official bootstrap/templates for Angular/Analog + Cloudflare, portable Node/libSQL/S3, and server-only use; simpler standard routes and admin setup; configuration diagnostics; clearer installation failures and onboarding.
- **Scope:** Maintained templates, setup tooling where justified, diagnostics, and measured onboarding documentation.
- **Non-goals:** A general-purpose project generator framework or unmeasured claims about setup speed.
- **Dependencies:** V2-01 release and support baseline.
- **Acceptance:** An independent developer can create, configure, persist, and edit a first collection through a short documented path. Measure and report onboarding time, targeting under ten minutes; do not claim that target until measured.
- **Evidence:** Clean-project consumer runs for each profile and timed independent onboarding reports.
- **Status:** **Planned.** Existing quickstarts are a foundation; no V2 bootstrap implementation is recorded.

## V2-03 — Forge Admin Platform

- **User problem and outcome:** Consumers need a usable default backoffice without rebuilding product pages in each application.
- **Existing foundation:** Reusable collections, forms, sign-in, users, and route mounting exist. Dashboard, media, API, and settings examples remain partly app-local.
- **Missing work:** Graduate reusable dashboard, Media Library, settings, API-key management entry points, and capability-aware navigation where justified; support identity, navigation, route mount, and host-provided page customization.
- **Scope:** A coherent shared default admin using real data and accessible interactions.
- **Non-goals:** Decorative metrics, inert controls, dead links, or a visual page editor.
- **Dependencies:** V2-01 security/accessibility baseline; V2-02 consumer setup path.
- **Acceptance:** A clean consumer gets a coherent usable default admin without rebuilding pages in its own app.
- **Evidence:** Packed consumer application exercising default and customized admin routes with real backing APIs.
- **Status:** **Planned.** Current admin reuse is proven; several dashboard and utility pages remain app-local.

## V2-04 — Professional Content Management UX

- **User problem and outcome:** Editors need to manage large collections, find records, and recover work without manual workarounds.
- **Existing foundation:** Drafts, versions, restore, list views, forms, and live-preview backend support exist.
- **Missing work:** Configurable columns, richer filters, saved views, permission-aware bulk operations, conditional fields, better relation navigation, usable version compare/restore, and editor-integrated live preview.
- **Scope:** Improve editorial list, detail, and recovery workflows by reusing existing backend capabilities.
- **Non-goals:** Adding unsupported query semantics or bypassing access checks for bulk actions.
- **Dependencies:** V2-03 shared admin platform.
- **Acceptance:** An editor can manage substantial collections and recover changes without manual workarounds.
- **Evidence:** Browser journeys over realistic seeded collections, permission-denial cases, keyboard and screen-reader checks.
- **Status:** **Planned.** Current docs describe simpler list and version experiences; no V2 implementation is recorded.

## V2-05 — Rich Text, Media & Authoring

- **User problem and outcome:** Everyday content authoring should not require editing JSON or managing files outside the CMS.
- **Existing foundation:** Rich text values serialize as JSON; the admin has a basic block editor and upload support.
- **Missing work:** Extensible rich-text editing for inline formatting, links, lists, and media; stable portable serialization; usable asset management, metadata, alt text, previews, optional image variants; investigate capability-aware direct uploads.
- **Scope:** Editorial authoring and asset workflows that work across supported profiles.
- **Non-goals:** Page-builder composition, provider-specific assumptions in the content format, or mandatory image processing on every adapter.
- **Dependencies:** V2-03 admin platform; coordinate with V2-06 content modeling.
- **Acceptance:** Everyday editorial authoring requires no manual JSON editing.
- **Evidence:** Cross-profile serialization fixtures, authoring and accessibility browser journeys, upload lifecycle and failure tests.
- **Status:** **Planned.** Current rich text is explicitly a simple block editor; no V2 editor exists.

## V2-06 — Advanced Content Modeling & Localization

- **User problem and outcome:** Teams need realistic structured and multilingual models without recurring casts or unsafe workarounds.
- **Existing foundation:** Typed collections, composite fields, top-level localized text/textarea, and adapter parity checks exist with documented limits.
- **Missing work:** Improve typed block unions and composite fields; safe nested relationships where feasible; more capable localized structured content; date/timezone and decimal/money modeling; practical query improvements with supported-adapter parity.
- **Scope:** Carefully bounded schema/query enhancements proven against every supported adapter.
- **Non-goals:** Unlimited relation depth or relaxing startup refusals without a safe contract.
- **Dependencies:** V2-01 release baseline; coordinate with V2-05 serialization.
- **Acceptance:** Realistic structured and multilingual content can be modeled and consumed without recurring casts or unsafe workarounds.
- **Evidence:** Strict compile-time consumer fixtures, runtime validation tests, and cross-adapter contract/parity runs.
- **Status:** **Planned.** The current limitations are documented in `docs/MATRICES.md`; no V2 changes are underway.

## V2-07 — Editorial Workflows, Versions & Identity

- **User problem and outcome:** Multiple editors need safe review, scheduling, publishing, and accountability.
- **Existing foundation:** Drafts, versions, restore, roles, users, API keys, and autosave intent exist; autosave retention and scheduled publication are not complete workflows.
- **Missing work:** Functional autosave with retention policy; scheduled publish/unpublish; minimal review lifecycle and permissioned transitions; scoped audit trail; optional email adapter for recovery/invitations; better user/API-key administration.
- **Scope:** Minimal dependable editorial workflow integrated with existing access rules.
- **Non-goals:** Enterprise SSO or a full external workflow engine.
- **Dependencies:** V2-03 platform and V2-04 content UX; V2-01 identity/security decisions.
- **Acceptance:** Multiple editors with distinct roles can safely create, review, schedule, publish, and audit content.
- **Evidence:** Role-separated end-to-end journeys, scheduling boundary tests, audit integrity and retention checks.
- **Status:** **Planned.** Existing drafts and versions are present, but the described workflow capabilities are not shipped as a whole.

## V2-08 — Developer Console & API Tooling

- **User problem and outcome:** Developers need to inspect a project model, exercise supported APIs, and diagnose integration issues without building their own tooling.
- **Existing foundation:** REST routes, OpenAPI-related tooling, schema planning, migration diagnostics, and operational health checks exist in separate forms.
- **Missing work:** Schema/catalog inspection, truthful REST/OpenAPI descriptions, authenticated API Explorer, drift/migration/adapter diagnostics, useful request/runtime health information.
- **Scope:** A safe developer console that connects real existing capabilities and exposes useful diagnostics.
- **Non-goals:** Generic Encore clone, public secret exposure, unguarded destructive actions, or an unbounded production debug surface.
- **Dependencies:** V2-03 admin platform; V2-09 operational diagnostic contracts.
- **Acceptance:** Developers can inspect the CMS model, test supported APIs, and diagnose common integration issues without building their own tooling.
- **Evidence:** Authorization and redaction tests, destructive-action safeguards, and consumer journeys on development and production-like configurations.
- **Status:** **Planned.** Diagnostics exist in CLI/scripts and health endpoints, but no integrated console is recorded.

## V2-09 — Production Operations & Portability

- **User problem and outcome:** Operators need repeatable upgrades, useful signals, and confidence they can recover supported deployments.
- **Existing foundation:** Schema plans, reviewed forward migrations, backup/restore procedures, a Cloudflare rehearsal, and a Garage S3 certification exist.
- **Missing work:** Migration observability, safe upgrade/restore procedures, backup-data validation and storage reconciliation, useful operational telemetry, additional S3 certification based on demonstrated need, explicit Worker/Node performance boundaries, real-version upgrade tests.
- **Scope:** Close operational gaps and maintain portable profiles using tested evidence.
- **Non-goals:** Automatically reversible SQL migrations or certification of every S3 provider without user need.
- **Dependencies:** V2-01 governance; V2-08 diagnostics where shared.
- **Acceptance:** Supported deployments can be updated, diagnosed, and recovered using repeatable tested procedures.
- **Evidence:** Historical real-version upgrade/restore rehearsals, corrupted backup and reconciliation tests, documented performance boundaries.
- **Status:** **Planned.** Current procedures and two profiles are foundations; the additional V2 evidence is not complete.

## V2-10 — Real-world Validation & 2.0 Certification

- **User problem and outcome:** A major release needs evidence from independent applications, not only repository-owned demos.
- **Existing foundation:** Packed consumer, release, compatibility, performance, and staging gates exist; the current state record says there is no maintained external consumer using the Angular/admin packages.
- **Missing work:** Independent external onboarding, multiple maintained consumer apps using the admin, acceptance against published packages, security/accessibility/performance/restore evidence, documented 1.x-to-2.0 migration, RC certification, and final release gate.
- **Scope:** Independent use and an intentional certified compatibility/product milestone.
- **Non-goals:** Star counts as a release criterion, arbitrary breaking changes, or release based on internal demos alone.
- **Dependencies:** V2-01 through V2-09 acceptance evidence.
- **Acceptance:** External-use evidence plus a verified migration and release process.
- **Evidence:** Published-package consumer reports, migration rehearsal, complete certification record, and signed release authorization.
- **Status:** **Planned.** Existing internal certification is a foundation; external Angular/admin consumer validation is not recorded.
