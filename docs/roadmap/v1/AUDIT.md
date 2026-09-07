# V1 assessment — evidence before scope

Source assessment baseline: 2026-09-06, commit `d518878`. Rechecked for product planning on
2026-09-07 at current main `28ff76c`; intervening changes are documentation only. All ten public
package manifests are `0.4.0`. GitHub API confirms main and latest public release
[v0.4.0](https://github.com/Andersseen/ForgeCMS/releases/tag/v0.4.0), published 2026-09-03.
Repository review, not a penetration test or fresh registry-artifact/deployment certification.
“Observed” means read in source/config; untested interleavings remain risks, not reproduced failures.
Paths below are repository-relative. No product code was changed during planning.

## What is strong

| Strength                       | Evidence                                                              | Value                                                                      |
| ------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Separation of concerns         | runtime `operations.ts` / `handlers.ts`, adapter interfaces           | Server consumers use business operations without HTTP                      |
| Adapter parity infrastructure  | `packages/testing/src/contracts/`, database/Cloudflare suites         | Shared query and constraint semantics prevent development/production drift |
| Real backend tests             | `packages/cloudflare/test/workers/`, tiny-project D1/libSQL fixtures  | Already goes beyond mocks; extend this foundation                          |
| External-consumer verification | `apps/tiny-project`, `scripts/verify-release.mjs`, spec 055           | Packed artifacts already exposed real reusable-library defects             |
| Useful feature set             | Local API, auth, API keys, drafts, globals, relations, reusable admin | Enough product value for a deliberately small 1.0                          |
| Strict tooling / delivery      | TypeScript strict, ESM, Changesets, SDD, CI                           | Good basis for bounded lower-cost model assignments                        |
| Recorded dogfooding            | DEMO-FINDINGS, specs 040–056                                          | Consumer friction has produced generic fixes, not just demo polish         |

## Findings

Before fixing an observed code path, prove its exact failing invariant in a regression test that
retains existing route/auth mitigations. No finding below asserts exploitation in a live deployment.

| ID / priority                                      | Evidence and assessment                                                                                                                                                | Required action                                                                                     | Packet            |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------- |
| F01 / high planning risk                           | STATE's current sections conflict with old debt saying no globals/versions; CLAUDE calls admin both skeleton and real; ARCHITECTURE omits current count/query behavior | Reconcile current snapshots and archive history so models do not recreate shipped work              | B01               |
| F02 / high assurance gap                           | CI runs `e2e:www`/`test:cloudflare`, not `test:libsql`, `e2e:tiny-project`, `e2e:demo`; tiny-project's ordinary tests exclude libSQL integration                       | Make relevant existing suites required and release-dependent                                        | B03               |
| F03 / medium assurance gap                         | Root Vitest only configures coverage reporters; scripts do not enable it and thresholds are absent                                                                     | Measure all source and behavioral coverage before claiming coverage completeness                    | B04               |
| F04 / high access risk, observed                   | `runtime/src/versions.ts` ignores received `user`/`overrideAccess`; restore calls adapter update directly; runtime delegates directly and HTTP passes false            | Enforce row/field access, filtering, current validation and hooks on history/restore                | A01               |
| F05 / high access risk, observed                   | `runtime.ts` preview reads raw rows and calls population without caller access options                                                                                 | Define preview access and projection, then prove Local API and HTTP behavior                        | A02               |
| F06 / high access risk, observed                   | `populate.ts` filters related fields but directly queries target rows without their collection-access/draft predicate                                                  | Test readable parent → unreadable/draft target; field filtering alone is insufficient               | A03               |
| F07 / high lifecycle risk, observed                | Users adapter validates signed token and returns its embedded user without refreshing the row; logout only clears cookie                                               | Define role freshness and invalidation after demotion, deletion, password changes and logout        | H03               |
| F08 / high concurrency risk, interleaving unproven | Users adapter checks `hasAnyUser`/`countAdmins` before separate writes; DB contract has no conditional atomic mutation                                                 | Reproduce parallel first signup / last-admin removal against independent runtimes and real backends | H01, H02          |
| F09 / high integrity risk, observed                | `relation-integrity.ts` examines top-level relations, skips same collection, directly deletes/updates adapter rows; many-relations scan all records                    | Define nested/self/transitive/cyclic behavior, hooks, partial failure and bounded work              | D01, D02          |
| F10 / high integrity risk, observed                | Versions read latest number then insert; document update/restore precedes snapshot write                                                                               | Prove concurrency and fault semantics; do not claim atomic history today                            | D01, D03          |
| F11 / medium contract gap                          | `globals.ts` accepts `depth` without population, does not apply returned access query, and lacks collection-like draft visibility on reads                             | Matrix supported global options; implement safe semantics or explicitly reject inert combinations   | A04, D04          |
| F12 / high maintenance gap                         | `syncSchema` is additive; contract has no migration history or reviewed destructive-change protocol                                                                    | Add detection, upgrade fixtures, backup and recovery; a full CLI is unnecessary                     | M01–M03           |
| F13 / high adoption gap                            | Angular service has configurable content base but literal `/api/auth/*`; many errors become plain Error; generics do not infer schema                                  | Stabilize configuration, error metadata and safe wire types                                         | C01–C03           |
| F14 / high product gap                             | Client calls global fetch with relative URLs; Playwright starts dev servers; docs note missing SSR                                                                     | Prove production rendering/hydration and request isolation                                          | S01–S03           |
| F15 / medium portability gap                       | Storage exports InMemory; durable adapter is R2                                                                                                                        | Close with one S3-compatible adapter before 1.0; certify libSQL/S3 alongside D1/R2                  | B02, P01–P03, R01 |
| F16 / medium packaging risk                        | Angular/admin peer pins `21.2.0` differ from dev `21.2.10`; Vite peers exact; public roots expose implementation helpers                                               | Strict consumer installs and evidence-backed ranges; inventory export commitments                   | B02, C03, R01     |
| F17 / medium UI assurance gap                      | Admin index tests mostly check exports; helper tests and some browser coverage exist                                                                                   | Add observable component-state tests and consumer workflows; smoke exports do not prove UX          | U01–U03           |
| F18 / high certification gap                       | STATE distinguishes local D1/R2 from unverified remote deployment; browser suites use dev servers                                                                      | Add built-artifact and authorized isolated remote smoke evidence                                    | R01, R03          |

## Conclusion

The architecture is credible. Enforcement is uneven: ordinary CRUD has a developed pipeline while
versions, preview, population and cascade bypass parts of it. A large feature inventory does not yet
imply uniform guarantees. Historical “hardening complete” milestones are not evidence for every
combination, concurrent mutation or dependency failure.

Do not rewrite the monorepo in response. Reuse operations and test fixtures; introduce shared policy
only when its inputs, outcomes and regressions are explicit. The review justifies immediate safety fixes and bounded guarantees, not generic CMS feature
expansion. Angular/Analog consumption is the strategic differentiator: client work moves to 0.8,
SSR to 0.9, and basic durable portable files to 0.10. Spec 055 already proves small-project usability;
spec 056 polish is complete. Preserve both as foundations rather than scheduling replacements.

## Verification limits

Required lint, typecheck, unit-test and build commands were run during planning; results are recorded
in STATE's v1 planning entry. Turbo reused results where available: a cached pass is not a new
exhaustive execution. No new coverage percentage was measured.

Browser, packed-install, real-backend and concurrency suites were inspected as source but not newly
executed for this documentation task. No remote deployment was performed. Their absence from this
session is not a failure result; they remain explicit implementation/release gates. This assessment
does not certify production readiness.

## Product sequencing of the findings

F01–F06 feed the combined 0.5 contract/access foundation; F07–F11 feed 0.6 auth/data lifecycle
(with F11 access in A04). F12 remains upgrade safety at 0.7, F13/F16 inform the 0.8 Angular client,
F14 the 0.9 production SSR path, F15 the 0.10 portable-storage profile, F17 the 0.11 existing-admin
verification, and F18 the 0.12 candidate evidence. B02/C03/R01 retain peer/export checks throughout.
Packet IDs and underlying evidence are preserved; they do not mandate distinct releases or PRs.

No S3 adapter was found in current exports/packages. All three consumers set `ssr: false`; existing
Local API server routes are useful foundations but do not demonstrate rendered HTML/hydration.
The named security findings remain immediate patch priorities when reproduced. Concurrency rows
remain unproven interleavings until tested with independent writers; planning is not a defect fix.
