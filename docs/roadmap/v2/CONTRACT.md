# ForgeCMS 2.0 product contract

This contract defines the product commitments against which V2 proposals and releases are evaluated. The canonical ordered IDs, titles, summaries, and statuses live in [milestones.json](milestones.json).

## Product commitments

- ForgeCMS is a code-first headless CMS. TypeScript schemas remain the source of truth.
- Angular and Analog are the primary integration advantage. REST and server-side consumption remain usable without Angular.
- ForgeCMS is Cloudflare-first, not Cloudflare-locked. Portability is demonstrated through maintained adapters and evidence, not slogans.
- A professional, reusable Angular admin is included by default and can be customized by host applications.
- The developer console must provide real model inspection, API testing, and diagnostics; it is not a generic Encore clone.
- V2 adds product capabilities while addressing known weaknesses. Runtime, API transport, admin UI, adapters, and developer tools retain clear boundaries.
- Product milestones are checkpoints, not required npm minor versions. Compatible improvements may ship in 1.x under SemVer. V2.0 denotes an intentional, certified compatibility and product milestone; a breaking change needs a stated justification.

## Boundaries

V2 excludes Forge Builder, page builders, visual layout editors, drag-and-drop page composition, and a plugin marketplace. It does not require GraphQL, PostgreSQL, MongoDB, enterprise SSO, or feature parity with Payload or Strapi. These may only be reconsidered through an explicit future product decision and specification; they are not implied by this roadmap.

The roadmap is not a delivery schedule. No target dates, release versions, completion percentages, or shipped capability claims are implied by a milestone's position.

## Changing commitments

Change a product commitment only through a reviewed documentation change that explains the user need, impact on current consumers, evidence, and affected milestones. Update the canonical inventory and public roadmap in the same change. Feature implementation requires a separate approved spec under `docs/specs/`; this roadmap document does not authorize feature work.

## Status meanings

- **Shipped** — released and supported by evidence. The 1.0 baseline is shipped.
- **In Progress** — implementation has started on an approved, active spec and the status is backed by branch evidence.
- **Next** — the next bounded product checkpoint; no claim that implementation has started.
- **Planned** — accepted direction with no active implementation commitment.

Status is not a percentage. Move a milestone to In Progress only with an approved feature spec and active implementation. Mark it Shipped only after its acceptance criteria and required evidence pass. V2-01 is Next because the 1.0 post-publication dossier records incomplete closeout verification and open governance/security follow-up. V2-02 through V2-10 are Planned.

## Definition of done

A milestone is done when its user-facing acceptance conditions pass, required evidence is recorded, support and migration implications are documented, and applicable security, accessibility, portability, and release checks in [QUALITY.md](QUALITY.md) pass. The milestone record must link to its implementing specs and evidence. A release label alone is not evidence.
