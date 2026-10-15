# 095 — First-publication prerelease registry safety

- **Status:** done
- **Author:** agent draft
- **Date:** 2026-10-15
- **Branch:** `fix/spec-095-first-rc-registry-safety`
- **Affected packages/apps:** none (release scripts and `.github/workflows/release-rc.yml` only)

## Context / Why

Preparing to publish the certified `1.0.0-rc.1`, the manual `release-rc` workflow was found to fail before its first publication. `@forge-cms/agent` is new: npm answers `E404` for it, and after a first `--tag rc` publication
it legitimately has `rc → 1.0.0-rc.N` and **no** `latest`. The spec 092 verifier assumed every fixed-family package already exists (any non-zero `npm view` threw) and already has a stable `latest` (one scalar, all equal).
Reproduced read-only against the real registry: `release-rc-verify --phase pre 1.0.0-rc.1` died with `npm view @forge-cms/agent dist-tags failed`.

## Goal

The manual RC workflow can safely publish a fixed-family candidate when some packages already have a stable `latest` and another is introduced for the first time under `rc`; absent and prerelease-only packages are handled
deliberately, and any movement of an existing stable `latest` (or any `latest → RC`) still fails closed.

## Non-goals

No package/runtime change, no new public API, no version bump, no RC publication, no website/demo feature, no L02, no stable 1.0.

## Design

Registry model, per package (generic — no special case for `agent`): `{ exists, latest }` where `latest` is a stable version or `null`.

- **absent** (`exists:false`, genuine E404 only) · **stable** (`latest` = stable semver) · **prerelease-only** (`exists:true`, `latest:null`) · anything else is an error.
- `isRegistryNotFound(output)` (`release-decision.mjs`, also used by `publish-unpublished.mjs`) is the single E404 test. Network/401/403/timeout/invalid JSON/non-object responses throw.
- **PRE** (`--phase pre <v> --snapshot <file>`): fixed family at exactly `<v>` (before any registry call); builds the snapshot; every existing `latest` stable and equal; ≥ 1 package establishes the baseline; a
  `latest` that is a prerelease or malformed fails. Writes `{ stableBaseline, packages: { name: { exists, latest } } }` (no credentials, no other npm metadata).
- **POST** (`--phase post <v> --snapshot <file>`): consumes the exact PRE snapshot; every package exists (E404 fails), `rc → <v>`, and `latest` equals the recorded value — a package that had none must still have none, so
  `agent latest → 1.0.0-rc.1` fails the workflow (release incident).
- The workflow passes `$RUNNER_TEMP/forge-rc-pre.json` between steps instead of a scalar output. Triggers, exact-SHA/clean/green-CI checks, `--tag rc`, provenance and prerelease GitHub release are unchanged.
- Resumability: PRE accepts a partially published state; `publish-unpublished` skips existing versions and never moves a dist-tag; nothing is unpublished or overwritten.

## Implementation plan

- [x] `release-decision.mjs`: `isRegistryNotFound`, `registryStateFromDistTags`, `buildPreSnapshot`, `assertPostSnapshot`
- [x] `release-rc-verify.mjs`: snapshot CLI, E404 vs failure, timeout
- [x] `publish-unpublished.mjs`: reuse `isRegistryNotFound`
- [x] `release-rc.yml`: snapshot passed through `$RUNNER_TEMP`
- [x] tests (`release-rc-verify.test.mjs`, partial-publication case in `release-prerelease.test.mjs`)
- [x] STATE, dossier J17, roadmap handoff. No changeset (no `packages/*` change).

## Test plan

`scripts/release-rc-verify.test.mjs` spawns the real script against a fake `npm` (never the real registry): all-stable; 11 stable + E404; 11 stable + prerelease-only; partial publication; differing baselines;
prerelease/malformed `latest`; no baseline; network/403/401/timeout; invalid JSON; family mismatch before any registry call; POST: missing/wrong `rc`, `latest` moved/vanished/`→ RC` on a first publication, E404 after publication.
Plus a partial-publication run of `publish-unpublished` (only missing packages published, `--tag rc`, provenance, no dist-tag call). A read-only PRE run against the real registry is an acceptance criterion.

## Acceptance criteria

1. Old behaviour reproduced (real registry). 2. Matrix above passes. 3. Real read-only PRE passes with baseline `0.13.4`, eleven existing, `@forge-cms/agent` absent. 4. `git diff main -- packages api-baseline` empty,
   no version or changeset change. 5. `release:certify` and the standard gates green; PR CI green.

## Open questions

None.

## Outcome

Verifier rewritten around a per-package snapshot; 24 new tests. Real PRE (2026-10-15): baseline `0.13.4`, 11 existing, `@forge-cms/agent` absent → passes. The RC is still unpublished (maintainer-authorized action).
