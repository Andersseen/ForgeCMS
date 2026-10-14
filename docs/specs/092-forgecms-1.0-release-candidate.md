# 092 — Produce and validate a ForgeCMS 1.0 release candidate

- **Status:** done (candidate prepared and certified; publication pending authorization)
- **Author:** agent draft (maintainer-directed, roadmap L01)
- **Date:** 2026-10-14
- **Branch:** `release/spec-092-forgecms-1.0-rc`
- **Affected packages/apps:** release scripts (`scripts/*`), `.github/workflows/ci.yml`, `.github/workflows/release-rc.yml`, `SECURITY.md`, docs, all eleven public packages (version only)

## Context / Why

Roadmap 0.12 (R01–R04) is complete. The stable family is `0.13.4`. The dossier ([1.0-RELEASE-DOSSIER.md](../1.0-RELEASE-DOSSIER.md)) lists J1 (no private security
channel) and J2 (no RC matrix) as blockers. The release helpers were written for stable releases: `publish-unpublished.mjs` passed no `--tag` (npm's default is
`latest`) and `create-github-release.mjs` hard-coded `prerelease: false`. Changesets does not protect `latest` for us, so a prerelease path has to be made safe
before one can exist.

## Goal

One exact fixed-family ForgeCMS `1.0.0-rc.*` commit is produced by Changesets, all eleven public packages share that version, the exact tarballs are certified
through the full 1.0 matrix, publication machinery cannot move npm `latest`, and an explicitly tagged RC can be published and independently verified without
substituting different bytes.

## Non-goals

No product features; no public API change; no admin redesign; no provider expansion; no Angular major migration; no Strata Server Components; no
GraphQL/plugins/CLI/email; no performance optimization unless an existing budget fails; no `1.0.0` stable; no L02 observation; no L03 release.

## Design

### Modes and the dist-tag decision

`scripts/release-decision.mjs` classifies a version as `stable` (`X.Y.Z`) or `prerelease` (`X.Y.Z-id.N`); anything else throws. The release mode of the family is
`stable`, `prerelease` or `none`; a mixed family throws. **The one prerelease npm dist-tag is `rc`** (the version identifier is `1.0.0-rc.N`, so the tag names what
it carries; `next` would be ambiguous with later work). Expected registry state after an authorized RC: `latest` → `0.13.4` (unchanged), `rc` → `1.0.0-rc.N`.

`resolvePublishTag(version, tag)` is fail-closed: stable + no tag → default (existing behaviour); stable + tag → refused; prerelease + no tag → refused;
prerelease + `latest` → refused; malformed tag → refused.

### Scripts

- `publish-unpublished.mjs [--tag <t>] [--dry-run]` resolves every package's tag **before any registry call**, then keeps its per-package `npm view` existence
  check (already published → skip; 404 → publish with `--tag`, `--access public`, `--provenance`; anything else → fail). Never unpublishes or overwrites.
- `create-github-release.mjs [--mode stable|prerelease]` refuses when the requested mode differs from the family's mode. Prerelease: tag `vX`, `prerelease: true`,
  skips the first-parent "introduced" test (the manual dispatch is the explicit act); existing release/tag → no-op.
- `release-mode.mjs` prints/exports the family mode and whether `.changeset/pre.json` exists.
- `release-rc-verify.mjs --phase pre|post` asserts the exact eleven-package family at the expected `1.0.0-rc.N`, that npm `latest` is a stable version before, and
  after publishing that every package has `rc` → version and `latest` is unchanged.

### Workflows

- `ci.yml` `release` job: a `Detect release mode` step; every publishing step runs only when `mode == 'stable'`. A prerelease version on `main` publishes nothing
  from that job (it never reaches `changeset publish`, which in Changesets pre mode would otherwise choose its own tag). Required job names are unchanged.
- `release-rc.yml`: `workflow_dispatch` only (inputs: exact `sha`, expected `version`). Checks out that SHA, requires it clean, requires a green `ci.yml` run for
  that SHA, installs, runs the pre-verification (family, version, `latest` stable), builds, `release:verify`, publishes with `--tag rc` and provenance, runs the
  post-verification (fails if `latest` moved or any `rc` tag is wrong), then creates the prerelease GitHub release. No website or Cloudflare deploy.

### Resumability

A network failure after package N is recovered by re-running the workflow with the same inputs: published packages are skipped, the rest are published with
`--tag rc`. No version is ever republished or replaced.

### Versioning

A major Changeset for the eleven fixed packages represents the 1.0 compatibility commitment (no new feature versus 0.13.x; surface frozen in U03; R01–R04
evidence). `pnpm changeset pre enter rc` then `pnpm changeset:version` produce `1.0.0-rc.N`; versions are never edited by hand.

### Next RC after a defect (L02 procedure)

1. Fix the defect with a focused regression test.
2. Add a changeset (honest bump) under `.changeset/`.
3. `pnpm changeset:version` (still in pre mode) → `1.0.0-rc.N+1`; commit.
4. Run the affected and downstream matrix and `pnpm release:certify` on the new clean commit; record the new hashes.
5. Dispatch `release-rc.yml` with the new SHA and version. `latest` stays unchanged.

A material auth/data/API/runtime fix invalidates earlier observation evidence; a docs typo does not necessarily invalidate technical evidence — L02 decides from
impact. Do **not** run `changeset pre exit` until L03.

## Implementation plan

- [x] Release-decision helpers, `publish-unpublished`, `create-github-release`, `release-mode`, `release-rc-verify`
- [x] `release-rc.yml`; `ci.yml` stable-mode guard
- [x] Script tests (`scripts/release-prerelease.test.mjs`)
- [x] J1: private vulnerability reporting enabled and `SECURITY.md` updated
- [x] Website `CURRENT_FORGE_VERSION` → `0.13.4`
- [ ] Major changeset, pre mode, version, RC notes, candidate commit
- [ ] Certification and full matrix on the exact commit
- [ ] Dossier, STATE, roadmap
- [ ] (needs authorization) RC publication and registry comparison

## Test plan

`node --test scripts/*.test.mjs` (mode detection, tag resolution, family assertion, publish script spawned against fake `npm`/`pnpm`: stable, untagged
prerelease, `--tag latest`, `--tag rc`, resume). Then the full matrix listed in the Outcome on the candidate commit.

## Acceptance criteria

The 68 numbered requirements of the L01 instruction (1–61 for repository work; 62–68 only if publication is authorized).

## Open questions

None.

## Outcome

**Baseline.** Started from `main` `afcc0ee`; PR #98 was merged by the maintainer on 2026-10-14 and published `0.13.4` (npm `latest`, GitHub `v0.13.4`); no pending changeset, no `pre.json`.
**Security.** Private vulnerability reporting was disabled; enabled with the maintainer's authorization and verified (`{"enabled":true}`); `SECURITY.md` updated; J1 closed.
**Release tooling.** `release-decision.mjs` (version/mode classification, fail-closed `resolvePublishTag`, fixed-family and `latest` assertions, GitHub release plan, pre-mode changeset coverage); `publish-unpublished --tag` (prerelease without tag or with `latest`
fails before any registry call; resumable; provenance kept); `create-github-release --mode` (RC -> `prerelease: true`); `ci.yml` `release` job publishes only in `stable` mode; manual `release-rc.yml`; `check-changesets.mjs` for the CI check. 89 script tests.
**Versioning.** `pnpm changeset pre enter rc` + a major changeset -> `1.0.0-rc.0` (never published, superseded by spec 093); the next `pnpm changeset:version` produced `1.0.0-rc.1` for all twelve packages. No version was edited by hand.
**Candidate.** `02ba1e68deabfd80e7eac55ad5cbeb2e8862dee7`, `1.0.0-rc.1`, clean tree; hashes and the matrix are in the [dossier](../1.0-RELEASE-DOSSIER.md#l-l01--the-release-candidate). `rc.0` evidence (`f25ae13`) is historical only.
**Publication.** Not authorized yet. npm `latest` stays `0.13.4`; nothing was published to npm or GitHub; no registry comparison exists (J11 open).
**Optional follow-ups.** J3 (remote D1 migration) and J4 (remote admin login) not run - no authorization.
