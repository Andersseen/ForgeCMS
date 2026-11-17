# 108 — Close the 1.0 closeout, protect main and gate npm publication

- **Status:** in-progress (evidence recorded; GitHub settings **applied 2026-11-17** after maintainer confirmation; `NPM_TOKEN` move pending — maintainer)
- **Author:** agent draft (scope approved by the maintainer's 1.1.0 / V2-01 brief, 2026-11-17)
- **Date:** 2026-11-17
- **Branch:** `feat/admin-angular-22` (the single 1.1.0 PR, #127)
- **Affected packages/apps:** none (repository governance, `.github/workflows`, docs)
- **Release:** part of **1.1.0**. No package change.

## Context / Why

The [1.0 dossier](../1.0-RELEASE-DOSSIER.md#l03-publication-and-closeout-2026-10-18) closed L03 as **PARTIALLY RELEASED**. `1.0.0` was published when PR #115 was merged, although its body said publication was not authorized, and the npm artifacts were never independently compared with their source. `main` has no active protection. V2-01 requires the closeout to be finished, `main` protected, publication authorization restricted, and a security review of the 1.1 diff with no unmitigated critical/high findings.

## 1. Published 1.0.0 artifacts versus the recorded source (done 2026-11-17)

All read-only. Source: a clean detached worktree of `82e4cdb0448d78d937c03c57edb21ee2a9fb210a` (the `v1.0.0` target), `pnpm install --frozen-lockfile`, `pnpm build --force`, `pnpm pack` per package.

| Check                                                                                                                                | Result                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm registry:compare --version 1.0.0 --local <packs>` (file list, per-file SHA-256, executable bits, exports, dependencies, peers) | **12/12 content-identical** (tarball hashes differ, as expected)                                                             |
| npm SLSA provenance of each `@forge-cms/*@1.0.0`                                                                                     | **12/12** `resolvedDependencies.gitCommit = 82e4cdb…`, `refs/heads/main`, `.github/workflows/ci.yml`, subject = that package |
| `npm audit signatures` over the twelve packages and their dependencies                                                               | 148/148 verified registry signatures; 42 verified attestations                                                               |
| dist-tags                                                                                                                            | `latest` = `1.0.0` and `rc` = `1.0.0-rc.2` on all twelve                                                                     |
| `pnpm registry:consumers --version 1.0.0` (server, angular, ssr, agent; 1.0.0's own scripts)                                         | **passed**                                                                                                                   |
| `registry:consumers … ssr-journey`                                                                                                   | **not run locally**: it needs Docker (Garage); no Docker on this machine                                                     |

Registry sha256 per tarball: core `914182a1…`, db `388e25f4…`, auth `5dd9da90…`, storage `6d2ca364…`, s3 `312993f1…`, api `29226101…`, runtime `45519216…`, cloudflare `21d90043…`, angular `90bf8c06…`, admin `e44756ee…`, testing `11937654…`, agent `a88db85b…`. Full hashes are in the dossier.

The authorization discrepancy of #115 is unchanged history: nothing was republished, re-tagged or moved.

## 2. GitHub settings — exact changes (applied 2026-11-17 after the maintainer confirmed)

Current state (read 2026-11-17): `main` has no branch protection. Ruleset `Protect main` (id 21630744) is **disabled** (rules: deletion, non_fast_forward). Environments `production` and `production-demo` have no protection rules and no branch policy. The `release` job has no environment and publishes with the **repository** secret `NPM_TOKEN` on any push to `main` that carries a version bump; that is how #115 published. Default workflow token permissions: read.

### 2a. Activate and extend the `Protect main` ruleset

`PUT /repos/Andersseen/ForgeCMS/rulesets/21630744`:

```json
{
  "name": "Protect main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [
    { "actor_type": "RepositoryRole", "actor_id": 5, "bypass_mode": "pull_request" }
  ],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "Lint · Typecheck · Test · Build · Pack · E2E", "integration_id": 15368 },
          { "context": "E2E · apps (www, tiny-project, demo)", "integration_id": 15368 },
          { "context": "Certify packed artifacts · durable profiles", "integration_id": 15368 },
          { "context": "Reliability · Coverage · Performance", "integration_id": 15368 },
          { "context": "Stability · packed-and-profiles", "integration_id": 15368 },
          { "context": "Stability · tiny-project-demo", "integration_id": 15368 },
          { "context": "Stability · www", "integration_id": 15368 },
          { "context": "Changeset required for packages/* changes", "integration_id": 15368 }
        ]
      }
    }
  ]
}
```

- Every change reaches `main` through a PR with all eight CI jobs green and up to date. No direct pushes (the 2026-10-19 incident), no force-push, no deletion.
- Zero required approvals: a single maintainer cannot approve their own PR. Raise it when there is a second maintainer.
- **Bypass, admins only, through a PR (`pull_request` mode).** The "Version Packages" PR that `changesets/action` opens is created with `GITHUB_TOKEN`, so GitHub runs no workflows on it and its required checks never report. The admin can still merge it, and only through the PR. The alternative is a fine-grained PAT for `changesets/action`; the bypass avoids a new long-lived secret.

### 2b. A protected `npm-release` environment for publication

```bash
# create the environment: maintainer approval, main only
gh api -X PUT repos/Andersseen/ForgeCMS/environments/npm-release --input - <<'JSON'
{ "reviewers": [{ "type": "User", "id": 70518612 }], "prevent_self_review": false,
  "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
JSON
gh api -X POST repos/Andersseen/ForgeCMS/environments/npm-release/deployment-branch-policies -f name=main -f type=branch
```

- **The token (maintainer action):** create `NPM_TOKEN` as an **environment** secret of `npm-release` (Settings → Environments → npm-release; secret values cannot be copied through the API), then delete the repository secret `NPM_TOKEN`. Recommended instead: npm **trusted publishing** (OIDC) for each `@forge-cms/*` package on npmjs.com, with workflow `ci.yml`, environment `npm-release` and repository `Andersseen/ForgeCMS`. Then no npm token exists at all.
- **Workflow change, applied together with 2b:** `release` in `.github/workflows/ci.yml` and the publishing job in `.github/workflows/release-rc.yml` gain `environment: npm-release`. Every publication (and every `changesets/action` run on `main`) then waits for the maintainer's approval in the Actions UI. Merging a PR, as with #115, can no longer publish by itself.

### 2c. Deployment environments

`production` and `production-demo`: deployment branch policy = `main` only (`custom_branch_policies` + a `main` branch policy), the same calls as 2b without reviewers. The deploy jobs already run only on pushes to `main`; this enforces it at the environment.

### Verification after applying (recorded in the dossier)

`gh api repos/Andersseen/ForgeCMS/rulesets/21630744 --jq .enforcement` → `active`; `gh api repos/Andersseen/ForgeCMS/environments/npm-release --jq '.protection_rules'` lists the reviewer and the branch policy; a direct `git push origin main` is refused; the next `main` run's `release` job shows "Waiting for review".

### Applied (2026-11-17)

Applied after the maintainer's confirmation in the session. Read back from the API:

| Setting                                      | Read back                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ruleset `Protect main` (21630744)            | `enforcement: active`, rules `deletion`, `non_fast_forward`, `pull_request`, `required_status_checks` (the eight checks above), bypass `RepositoryRole 5 (admin)` in `pull_request` mode. `GET /rules/branches/main` returns those four rules. Classic branch protection stays unset (404), which is expected: rulesets replace it. |
| Environment `npm-release`                    | `required_reviewers: [Andersseen]`, `branch_policy` with custom policy `main`                                                                                                                                                                                                                                                       |
| Environments `production`, `production-demo` | `branch_policy` with custom policy `main`                                                                                                                                                                                                                                                                                           |
| Workflows                                    | `release` (`ci.yml`), `publish-rc` and `finalize-rc` (`release-rc.yml`) declare `environment: npm-release`                                                                                                                                                                                                                          |

**Pending (maintainer action):** add `NPM_TOKEN` as a secret of `npm-release` and delete the repository secret (or switch to npm trusted publishing). The repository secret remains readable from the environment job until then, so publication works either way, and approval is already required.

## 3. Security review of the 1.1 diff

Done (see the dossier's "1.1.0 security review"): no critical/high/medium finding. The review covers specs 103–107 (`git diff eb1f9f0..HEAD`), with findings and how each is resolved. Acceptance: no unmitigated critical/high findings.

## Acceptance criteria

1. 12/12 published artifacts content-identical to `82e4cdb`, with provenance and signatures verified (done).
2. After confirmation: ruleset active with the eight required checks; `npm-release` protected; `NPM_TOKEN` scoped to it (or trusted publishing); workflows reference it; evidence recorded.
3. Security review recorded with no unmitigated critical/high finding.

## Outcome

<!-- Fill when done. -->
