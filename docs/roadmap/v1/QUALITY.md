# V1 quality and compatibility contract

Proposed acceptance policy, not a report of current coverage. B04 measures the starting point.
The aim is **100% of promised behaviors linked to evidence**, not one browser test per function or
an unqualified promise that line coverage proves correctness.

## Test responsibilities

| Layer                      | Proves                                                                                   | Existing home / extension point                                          |
| -------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Unit                       | Validation, defaults, access decisions, query parsing, projection, errors, pure UI state | Colocated `packages/*/src/*.test.ts`                                     |
| Type                       | Positive inference and expected compile failures; wire types match runtime visibility    | `typed-local-api.test.ts`; add SDK consumer type fixtures                |
| Adapter contract           | Same supported CRUD/query/constraint/storage/auth semantics                              | `@forge-cms/testing/contracts`; all adapters run matching suites         |
| Real-backend integration   | SQL, serialization, failure/atomicity and persistence behavior                           | libSQL suites, `packages/cloudflare/test/workers`, tiny-project fixtures |
| HTTP contract              | Actual handlers: statuses, envelopes, request parsing, cookie/Bearer and projection      | runtime handler/auth integration suites; workerd HTTP fixture            |
| Component integration      | Observable loading/error/edit/save/focus behavior with Angular rendering                 | Admin/Angular tests; add rendered component fixtures only where useful   |
| Browser E2E                | Real user journey through actual routes and persistent backend where promised            | Existing www/demo/tiny-project Playwright fixtures                       |
| Packed production consumer | Published export resolution, strict peers, linker, SSR and hydration                     | Extend `scripts/verify-release.mjs` plus built consumer fixtures         |
| Upgrade / recovery         | Previous data survives supported schema/software changes and backup restore              | Dedicated seeded D1/libSQL fixtures introduced by M03                    |

Mocks are useful for fast branch/fault tests. They are insufficient evidence for real SQL, runtime
bindings, concurrency, cookie behavior, production linking or hydration.

## Commands and gate policy

Run `pnpm build` first when dist declarations are absent. Keep the mandatory sequence:
`pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus `pnpm format:check`.
For adapters, run both the package tests and applicable shared contracts / real backend suite.
No changeset is needed for this roadmap's docs-only work; later `packages/*` work needs one.

| Command currently available | Required use in the proposed pipeline                                               |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm test:cloudflare`      | Required for backend/runtime/auth/storage changes and every release candidate       |
| `pnpm test:libsql`          | Same rule for portable database behavior; not replaced by default `pnpm test`       |
| `pnpm release:verify`       | Package/manifest/consumer changes and every release candidate                       |
| `pnpm e2e:www`              | Existing admin/docs integration; required in CI                                     |
| `pnpm e2e:tiny-project`     | Canonical consumer/admin/auth journey; required in CI                               |
| `pnpm e2e:demo`             | Dogfooding/public-site integration; required before release and on affected changes |

B03 adds explicit jobs and a single aggregate required check. Release must depend on all applicable
checks, including the changeset check where relevant, not only a subset of successful jobs. Path
filters must not allow package/runtime changes to bypass consumer/backend tests. Documentation-only
changes may use a clearly defined reduced CI policy, but release candidates always use the full set.
New coverage, S3 integration, production-browser and upgrade commands are deliverables of their packets: do not
claim these commands already exist or instruct a model to run invented scripts.

Keep fast PR checks separate from slower certification jobs with independent timeouts and artifacts.
Store logs, reports and Playwright traces for failures. A retry may diagnose flakiness; it must not
erase first-attempt failure metrics. Shared server state must be reset or isolated per journey.

## Coverage without false confidence

1. B04 enables coverage using the existing Vitest toolchain and a justified provider dependency.
   Include every production source file, including files not imported by tests. Exclude generated
   dist, test fixtures and pure type declarations; document any further exception with an owner.
2. Record lines/statements/functions/branches per package, plus uncovered critical branches. Do not
   report the best package as the whole product. Preserve a baseline artifact on CI.
3. Proposed 1.0 floors: **90% lines/statements/functions and 85% branches** for non-UI packages;
   **85% lines/statements/functions and 80% branches** for Angular/admin runtime logic. Measure
   templates through rendered behaviors and browser evidence, not by pretending TS coverage counts HTML.
4. Every access-denial, credential invalidation, validation boundary, rollback/failure and deletion
   invariant has explicit positive/negative evidence regardless of aggregate percentage.
5. Start with a non-regression ratchet; close known gaps in their assigned minors. Reaching the 1.0
   floors is required by R02. Do not add meaningless assertions or exclude difficult modules to pass.
6. A documented impossible-to-cover branch requires review and a reason, not blanket exemption for
   a module. Security/data-loss behavior cannot be waived because the percentage passes.

These floors are proposed policy, not a measured baseline. B04 can propose better evidence-backed
thresholds for maintainer approval; it cannot silently weaken them during implementation.

## Required behavior matrix

| Capability          | Unit/contract cases                                                                                | HTTP / browser / consumer evidence                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| CRUD and validation | Required/unknown fields; partial update; null/omitted/default; duplicate uniqueness; missing ID    | Valid CRUD, invalid form, 201/204, pagination metadata and typed errors                                 |
| Query and count     | Every supported operator, AND/OR, multi-sort, bounds, empty/invalid operands, same count predicate | SDK serialization round-trips; pagination/filter/sort navigation                                        |
| Access              | Anonymous/admin/editor/viewer, row rules, field rules, Local default override vs false             | All read/mutation endpoints; HTTP always passes false; cross-user isolation                             |
| Indirect reads      | Target access, drafts, hidden fields, missing target, depth limit, locale                          | Relation/upload/preview/version/global responses cannot expose restricted content                       |
| Auth                | Bad/expired token, current roles, deleted user, password change, revocation, adapter outage        | Login/refresh/logout/replay; role demotion; CSRF; API-key scopes                                        |
| Provisioning        | Parallel bootstrap, last-admin races, invalid role, normal signup cannot escalate                  | First-run path opt-in; disabled bootstrap rejected; errors usable in UI                                 |
| Content history     | Restore current validation, hook policy, uniqueness/concurrency, failure before/after write        | Authorized restore; forbidden restore leaves data/history unchanged                                     |
| Relations           | Self/nested/many, restrict/cascade/set-null, cycles, hooks, fault injection                        | Supported actions are deterministic; unsupported combinations rejected before writes                    |
| Globals/locales     | Supported depth/access/draft/localized combinations; default/fallback; partial writes              | No cross-locale overwrite or draft leak; unsupported options fail clearly                               |
| Uploads             | Size/type, missing file, denied reads, cleanup failures, DB/storage partial failure                | Upload → persist → fetch → reload → delete; forbidden caller cannot read private file                   |
| SDK                 | Configured content/auth URLs, status/code/details, type inference, encoded identifiers             | Mounted API path, strict install, real server responses rather than mocks only                          |
| SSR                 | Absolute server URLs, request context, concurrent identities, safe transfer/cache                  | Production HTML contains public content; hydration works; no private data/token transfer                |
| Admin               | Dirty/failed saves, stale query results, role controls, confirmation, keyboard/focus               | Create/edit/publish/delete, login/users, mobile keyboard journey, server rejects forced forbidden calls |
| Upgrade             | Additive/destructive drift, indexes, migration ledger, restart/interruption, restore               | Previous-version fixture → new consumer → content/auth works; restore backup and verify integrity       |

For optional combinations, maintain an explicit supported/unsupported matrix. “Unsupported” must
mean a documented deterministic rejection at configuration or operation time, not silently wrong
results. Existing API input acceptance cannot be narrowed without migration notes.

## Deployment profiles

| Profile                       | Required evidence                                                                                             | Exclusions                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| InMemory                      | Fast contracts and default browser journeys                                                                   | No durability claim                                                          |
| Portable libSQL/S3            | Real DB + S3-compatible lifecycle, file persistence across restart, built-consumer journey and backup/restore | One tested standard runtime/service profile; no promise of every S3 provider |
| Local Cloudflare D1/R2        | workerd contracts/integration plus one built-consumer critical journey                                        | Local evidence does not prove remote configuration                           |
| Remote isolated D1/R2 staging | Correct bindings; persistence across deployment/restart; cookies; file lifecycle; logs                        | Only authorized staging, never destructive tests against production          |

Do not multiply every browser test by every backend. Full core browser flows can run against one
profile; run a minimal critical browser journey against each durable supported profile, with the
exhaustive semantics below that in contract/integration tests. SSR adds concurrent-identity evidence.
Record compatibility for Node, TypeScript, Angular, Analog, browser and peer dependencies from
actually tested versions; do not infer broad support from a successful local build.

## Release dossier

Record candidate commit/version, export/route matrix, peer-version matrix, each suite's result and
artifact, coverage, unresolved findings, upgrade/backup results, deployment profile and owner.
Performance budgets use a fixed documented fixture and runtime; R02 sets initial budgets from
measurement and freezes them before acceptance. Do not invent universal edge latency promises.

Critical journeys pass multiple clean isolated candidate runs with no unexplained flaky failures.
Use an RC observation period with real maintained-consumer use; choose any fixed period during
release preparation. Material auth/data/API fixes require renewed affected/downstream validation;
calendar days or arbitrary run counts do not substitute for evidence. Critical/high security or integrity findings block release. Lower-severity accepted issues
need impact, workaround, owner and follow-up; approval never substitutes for a missing core gate.

## DX and portable storage acceptance

Each milestone updates the runnable consumer guide for its changes. Verify install → define content
and users → configure auth/infrastructure → bootstrap admin → mount runtime/auth/admin → manage
content/files → typed Angular/Analog consumption → deploy → upgrade/restore, using only public
packages. R04 reconciles these guides; it is not the first developer-experience gate.

P01 adds `runStorageAdapterContractTests` and a real isolated S3-compatible service fixture. P02
proves libSQL/S3 upload, access, metadata, restart and cleanup/failure semantics with the existing
runtime pipeline. P03 extends M03 backup/restore to object bytes plus database references, and both
profiles' production consumer journeys. R01/R03 require D1/R2 **and libSQL/S3**; InMemory is never
portable durability evidence. S3-specific commands do not exist at this baseline and are introduced
by those packets. Test one representative S3-compatible service and document actual provider/runtime
coverage; supporting configuration for AWS S3, MinIO, B2 and Wasabi is not a promise to certify every
provider. No presigned uploads, CDN or image processing is required.

Use www for admin/docs verification, tiny-project for external-style setup and backend parity, and
demo-aesthetics for Local API/public UX regression evidence. Certify existing controls and spec 056
polish rather than redesigning these surfaces. SSR public-content evidence lands in 0.9 before S3;
0.10 adds complete durable files to the same consumer story.
