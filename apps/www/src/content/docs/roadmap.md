---
title: ForgeCMS roadmap
description: The shipped ForgeCMS 1.0 foundation and the evidence-led direction for ForgeCMS 2.0.
group: Project
order: 1
---

## ForgeCMS 1.0: shipped

ForgeCMS 1.0.0 is the stable, published foundation: TypeScript schemas, a Local API and REST API, Angular and Analog integration, a reusable Angular admin, and Cloudflare D1/R2 and portable Node/libSQL/S3 deployment profiles. See the [1.0 release dossier](https://github.com/Andersseen/ForgeCMS/blob/main/docs/1.0-RELEASE-DOSSIER.md) and [current capability matrix](https://github.com/Andersseen/ForgeCMS/blob/main/docs/MATRICES.md) for evidence and limits.

## ForgeCMS 2.0: the direction

V2 will make ForgeCMS more production-ready, developer-friendly, and editorially capable. TypeScript schemas remain the source of truth. Angular and Analog remain the primary integration advantage; REST and server-side use remain available outside Angular. The product stays Cloudflare-first and portable, with a professional reusable Angular admin included by default. A developer console should provide real schema inspection, API usability, and diagnostics.

The status shown for each V2 milestone is explicit:

- **Shipped** means released and supported by evidence. ForgeCMS 1.0.0 is shipped.
- **In Progress** means implementation has started under an approved, active spec.
- **Next** identifies the next checkpoint; it does not mean implementation has started.
- **Planned** means accepted direction with no active implementation commitment.

V2-01 is Next. The latest release record says post-publication closeout verification is incomplete. No V2 feature milestone is currently marked In Progress. Product checkpoints do not map one-to-one to npm minor versions; compatible features may ship in 1.x under SemVer. V2.0 is reserved for an intentional, certified compatibility and product milestone.

## V2 milestones

| ID    | Milestone                                 | Status      | Direction                                                                                         |
| ----- | ----------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| V2-01 | Foundation, Security & Release Governance | **Next**    | Close 1.0 certification follow-up and strengthen release, security, and accessibility governance. |
| V2-02 | Developer Experience & Project Bootstrap  | **Planned** | Make it faster to start, configure, diagnose, and build a first collection.                       |
| V2-03 | Forge Admin Platform                      | **Planned** | Grow the reusable Angular admin into a coherent default backoffice.                               |
| V2-04 | Professional Content Management UX        | **Planned** | Improve collection management, recovery, and editor workflows.                                    |
| V2-05 | Rich Text, Media & Authoring              | **Planned** | Support everyday editorial authoring with portable rich text and usable media tools.              |
| V2-06 | Advanced Content Modeling & Localization  | **Planned** | Expand structured and multilingual modeling while preserving adapter parity.                      |
| V2-07 | Editorial Workflows, Versions & Identity  | **Planned** | Add dependable review, scheduling, audit, and identity workflows.                                 |
| V2-08 | Developer Console & API Tooling           | **Planned** | Give developers safe, truthful tools to inspect and diagnose a ForgeCMS project.                  |
| V2-09 | Production Operations & Portability       | **Planned** | Make upgrades, observability, and recovery repeatable across supported profiles.                  |
| V2-10 | Real-world Validation & 2.0 Certification | **Planned** | Validate the product with independent consumers and a certified migration and release.            |

These are product checkpoints, not delivery dates or npm versions. Each milestone needs its own approved feature spec before implementation. The detailed [milestone scope, dependencies, acceptance criteria, and evidence](https://github.com/Andersseen/ForgeCMS/blob/main/docs/roadmap/v2/MILESTONES.md) explain what each status means in practice.

## Out of scope for V2

Forge Builder, page builders, visual layout editors, drag-and-drop page composition, and a plugin marketplace are outside V2. V2 does not require GraphQL, PostgreSQL, MongoDB, enterprise SSO, or feature parity with Payload or Strapi.

## Follow progress and contribute

Follow [GitHub issues](https://github.com/Andersseen/ForgeCMS/issues) for discussion and [pull requests](https://github.com/Andersseen/ForgeCMS/pulls) for implementation. Share the user problem and evidence for a proposed change. Roadmap status changes are published together with the internal milestone record. The original [V1 roadmap history](https://github.com/Andersseen/ForgeCMS/blob/main/docs/ROADMAP.md) remains available in the repository.
