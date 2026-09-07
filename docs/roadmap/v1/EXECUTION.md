# V1 execution handbook

A packet is one bounded implementation responsibility, not a release or necessarily a public
feature. A minor combines related packets into a coherent product/engineering outcome. One PR per
coherent implementation is the default; keep related code, tests and docs together. Split only
oversized or independently risky work. Avoid a giant branch for a minor and artificial tiny PRs. Follow [../../SDD.md](../../SDD.md), CLAUDE and CONVENTIONS.

## Ownership

| Role                       | Owns                                                                      | Boundary                                                           |
| -------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Maintainer / release owner | Product scope, spec approval, compatibility decisions, release acceptance | Passing tests do not authorize extra features                      |
| Architect / orchestrator   | Contract design, packet splitting, dependencies, ambiguity resolution     | Do not ask a smaller model to invent access/concurrency/API policy |
| Package implementer        | One approved behavior, focused regression, changeset                      | No unrelated exports, framework changes or host policy             |
| QA / reviewer              | Independent verification against the invariant and spec                   | Do not merely mirror implementation or count passing assertions    |
| Integration owner          | Thin routes, packed consumer, production build, backend profiles          | Do not hide generic package defects behind app-side workarounds    |
| Documentation owner        | Contract matrix, migration guide, STATE, release dossier                  | Planned work must never be recorded as implemented                 |

One person/model may hold multiple roles. The review pass still starts from the specification and
observable behavior. High-risk auth and consistency designs need an explicit architecture decision.

## Packet preparation for smaller models

Start with the assigned release brief, its findings and predecessor contracts; no separate
governance phase is needed. For changes requiring a spec under SDD, prepare a focused spec using
`docs/specs/TEMPLATE.md`. Bug fixes, tests and documentation do not acquire an extra spec requirement
from being assigned a packet. Include the relevant details below:

1. Packet/minor IDs and links to merged predecessor outcomes.
2. One observable goal, with a before/after scenario.
3. Exact reading list and file allowlist for production, tests and docs; forbidden areas.
4. Exact retained/proposed signatures, defaults, response shapes and error codes. This roadmap
   does not invent TypeScript signatures before design review. The implementer must not choose them.
5. Behavior table for success, invalid input, missing record, denied access, dependency failure
   and concurrency when relevant. Separate Local API errors from HTTP status/envelope behavior.
6. Aim for roughly ten meaningful implementation steps; split into `ID-a` / `ID-b` when the work
   is actually oversized or independently risky, not merely because it touches many files.
7. Test files, exact commands, required contract suites and expected regression outcomes.
8. Changeset classification, compatibility impact, migration and recovery notes.
9. Reviewer and completion evidence. Resolve open design questions before approval.

A design packet finishes with approved design documentation, not a claim that code is repaired.
The subsequent implementation consumes that decision. Per SDD, models cannot self-approve drafts;
an explicit maintainer request to implement a particular spec constitutes approval.

## Reusable assignment

> Implement packet **[ID]** for **[minor]** from approved spec **[path]**. Read CLAUDE, STATE,
> CONVENTIONS, the release brief and predecessor outcomes. The only goal is **[observable outcome]**.
> Edit **[file allowlist]** and the named tests/docs/changeset. Preserve **[contracts]**. Non-goals:
> **[list]**. Reproduce **[regression]**, implement, run **[focused commands]**, then repository gates.
> Report behavior, tests, migration effect and unresolved concerns. If a new public contract or
> concurrency decision is required, return the narrow question with evidence; do not expand scope.

## PR and dependency rules

- Merge predecessor contracts/tests before consumers. UI follows SDK behavior; the UI never defines
  server permission policy. Integration follows package contract verification.
- Shared files (`operations.ts`, `handlers.ts`, adapter interfaces, entry points) have one active
  owner. Independent documentation/infrastructure may proceed after recording the same B01 baseline.
- A coherent PR can complete related packets; a large packet can need multiple PRs. Record which
  acceptance criteria each covers. Packet IDs remain useful tracking references, not forced PRs.
- Capture behavior before refactoring. Do not combine a refactor, API redesign and new feature in
  one PR. No new abstraction or dependency without a concrete reason in the spec.
- Changes under `packages/*` need a changeset. Keep the existing fixed version group; no manual
  manifest bumps or publishing from implementation tasks. Apps remain private.
- Follow DEMO-FINDINGS rules when replacing a demo workaround. Shared logic belongs in packages.

## Handling current work

Spec 056 is marked done and merged; the previous planning pass reconciled its STATE heading.
The 2026-09-07 baseline is main `28ff76c`, public GitHub release v0.4.0 and ten manifests at 0.4.0.
Record its completed outcome and any remaining release bookkeeping in the 0.4.x baseline; do not
reimplement its redirects, overlays or landing polish. Decorative work must not delay access fixes.

Urgent confirmed access/data-loss regressions get a narrow current-line patch when feasible. If a
permanent repair needs a contract redesign, explicitly restrict the unsafe optional capability and
document migration until the dedicated minor is ready. Do not leave it enabled because work is
scheduled later. This rule does not authorize deployment or publication by an implementation agent.

## Versioning and freeze

Patches cover bugs, security fixes, UI polish, performance fixes, tests and documentation corrections.
Minor versions communicate meaningful capability/guarantee changes, not code volume.
Before 1.0, patches repair documented behavior; intentional API/default/configuration breaks use a
documented minor with migration notes. Experimental status is not permission for silent breakage.
From 1.0, compatible fixes are patches, additive compatible features minors, and incompatible public
changes require a major release.

0.5 freezes contract categories, not all final signatures. Finalize intentional changes during their
assigned minors. Freeze the actual 1.0 surface at 0.11 exit. 0.12 combines final certification and RC preparation;
RC accepts defects and evidence only. No extra minor is needed solely to record certification. A necessary breaking change reopens design, migration and downstream certification.

## Completion evidence

Every handoff contains commit, spec status, changed behavior/files, commands/results, regression
evidence, backend scope, changeset, migration impact and STATE update. Record skipped, cached and
blocked checks distinctly. A claim that tests pass must identify which suites actually ran.

Each minor closes with its own exit gate plus [QUALITY.md](QUALITY.md), changelog and updated
compatibility inventory. A missed gate delays that release; it cannot be replaced by future intent.
Estimate scheduling only after measuring completed packets. No invented hour/date commitments.

## Keep product use in each milestone

0.5 combines B/A foundation and access work; 0.6 combines H/D auth and content safety. 0.7 upgrades
precede 0.8 Angular and 0.9 SSR; 0.10 adds basic S3 and both complete durable profiles; 0.11 certifies
the existing admin; 0.12 consolidates evidence and L01 preparation before RC → 1.0. Dependencies
inside briefs describe actual required contracts, not a ban on useful earlier client/DX fixes.

Update consumer instructions as each capability changes. Test installation/configuration, first-admin
bootstrap, public route/admin mounting, typed consumption, deployment and upgrade without private
Forge internals. Use tiny-project, www/docs and demo-aesthetics as validation surfaces; no redesign
milestone is needed. Final certification assembles this evidence rather than starting DX work.

For RC, agree an observation period appropriate to the candidate and maintained-consumer use.
Require multiple clean certification runs and investigate flakiness; material auth/data/API fixes
restart affected and downstream validation. No universal day/run count determines correctness.
