# 077 — Angular resource reliability and peer compatibility

- **Status:** done (implemented and verified on the branch; merge pending)
- **Author:** agent draft (implementation requested by the maintainer, 2026-10-04 — "spec 077 — roadmap
  0.8 C03"; per [SDD.md](../SDD.md) an explicit request to implement counts as approval)
- **Date:** 2026-10-04
- **Branch:** feature/spec-077-angular-resource-reliability-peer-compat
- **Affected packages/apps:** @forge-cms/angular, @forge-cms/admin, scripts (release verification + new
  compatibility matrix), CI, apps/www (Angular client guide), docs

## Context / Why

Roadmap 0.8 / C03 ([0.8-angular-client.md](../roadmap/v1/0.8-angular-client.md)), after C01 (spec 075,
transport + `ForgeApiError` + per-call `AbortSignal`) and C02 (spec 076, typed client). Two problems remain.

**Resources.** `createResource()` (`packages/angular/src/resources.ts`) only drops out-of-order responses with
an incrementing `latest` counter. Reading the code against the C03 brief:

1. **No cancellation.** A superseded request keeps running; the C01 `AbortSignal` is never passed.
2. **Idle does not invalidate (bug).** When `params()` becomes `undefined` the effect only sets
   `isLoading(false)`; `latest` is not advanced, so the in-flight request is still "current" and
   repopulates `value` (or `error`) after the resource went idle. The previous `value` also stays — edit A →
   `new` in the admin editor keeps A's document as the create form's initial value.
3. **Previous query visible as current.** `value` is kept across a request change (A → B), so document A
   stays in the editor while B loads (`initialValue = value() ?? {}`) — a save in that window writes A's
   fields to B. A list keeps page 1's rows while page 2 loads.
4. **No credential boundary.** Nothing ties a resource to the identity it loaded under: after logout, or
   login as another user, the previous user's protected data stays in `value()` and an old request can still
   commit.
5. **Destroy.** The effect is destroyed with its owner, but the request keeps running and its handlers still
   write signals.
6. **No runtime tests** of resources exist (only C02 compile-time checks).

**Peers.** `@forge-cms/angular` and `@forge-cms/admin` pin every peer to an exact version (`@angular/*`
`21.2.10`, `rxjs` `7.8.0`, `vite` `7.0.0`, `@babel/core` `7.29.0`, `@voltui/components` `1.0.1`, `lumen-icons`
`0.2.0`). The 2026-09-17 production incident ([STATE.md](../STATE.md), "duplicate Angular bundled via
mismatched peer deps") was an _unsatisfiable_ exact peer (`21.2.0` vs the app's `21.2.10`): pnpm installed a
second `@angular/common` for admin's subtree and `PlatformLocation` crashed on the copy whose DOM adapter was
never initialised. Re-pinning to `21.2.10` only moved the cliff: any consumer on `21.2.11` hits the same
duplicate (lenient pnpm) or an install failure (strict pnpm). Already today the first-party apps use VoltUI
`1.1.0` against admin's exact `1.0.1` peer and `rxjs` `7.8.2` against `7.8.0`. `release:verify` installs with
pnpm's lenient defaults, so none of this is detected. The README/resources comment claim "Angular 19 and up",
which nothing tests.

## Goal

Angular resources have deterministic cancellation, staleness and reset semantics across query changes, idle,
reload, destroy and credential changes, and the published Angular/admin packages advertise only peer ranges
proven by strict packed-consumer installs and production builds.

## Non-goals

- Roadmap 0.9 / SSR / Analog Local API, hydration, transfer state.
- Replacing `createResource`/`ForgeResource`, adopting Angular's experimental `resource()`/`httpResource()`,
  an `isRefreshing` signal, caching, deduplication, retries (reads or writes), RxJS query frameworks, global
  state libraries, interceptors.
- Redesigning `CmsApiService`, `ForgeAuthSession`, the transport or the admin UI.
- Widening third-party UI peers (VoltUI, Lumen Icons) beyond what installs prove; supporting Angular majors
  that VoltUI does not support in `@forge-cms/admin`.
- Cancelling non-resource calls (`CmsApiService` writes stay caller-controlled via `{ signal }`).
- Making a non-reactive `authToken` function observable (see §3).

## Design

### 1. Resource state contract (`ForgeResource<T>` — public API unchanged)

`value: Signal<T>`, `isLoading: Signal<boolean>`, `error: Signal<Error | null>`, `reload(): void` keep their
types. Definitions:

- **request** — a non-`undefined` result of `params()`. Its **key** is the wire identity:
  `collection + buildQueryString(query)` for `collectionResource`, `[collection, id, depth]` for
  `documentResource`. Two requests with the same key are "the same request".
- **attempt** — one execution of a request: one `AbortController`, one `load()` call.
- **credential revision** — see §3. A committed result belongs to the revision it started under.

Invariants:

- `value()` is `undefined` or the result of a successful attempt of **the current key under the current
  credential revision**. Never a different key, never another identity.
- `value()` and `error()` are never both set.
- At most one attempt is current. Only the current attempt may write `value`/`error`/`isLoading`.

| Transition                           | `value()`                                 | `isLoading()`              | `error()`            | Previous attempt                         |
| ------------------------------------ | ----------------------------------------- | -------------------------- | -------------------- | ---------------------------------------- |
| Created, params `undefined` (idle)   | `undefined`                               | `false`                    | `null`               | —                                        |
| First load (idle → request)          | `undefined`                               | `true`                     | `null`               | —                                        |
| Success                              | result                                    | `false`                    | `null`               | —                                        |
| Real failure (HTTP/network/invalid)  | `undefined`                               | `false`                    | the error, as-is     | —                                        |
| Key change (query/ID/page/sort…)     | `undefined` (reset)                       | `true`                     | `null`               | aborted, can never commit                |
| `reload()` / same-key re-run         | **kept** (same request)                   | `true`                     | `null`               | aborted, can never commit                |
| Request → `undefined` (idle)         | `undefined` (reset)                       | `false`                    | `null`               | aborted, can never commit                |
| `undefined` → request                | as "first load"                           | `true`                     | `null`               | —                                        |
| Slow A → fast B                      | B's result when B settles                 | `true` until B settles     | B's error only       | A aborted; A's late result/error ignored |
| Slow A → idle                        | `undefined`                               | `false`                    | `null`               | A aborted; ignored                       |
| Superseded attempt rejects `aborted` | unchanged                                 | unchanged                  | unchanged (no error) | —                                        |
| Owner destroyed                      | frozen (no further writes)                | frozen                     | frozen               | aborted; never writes                    |
| Credential revision changes          | `undefined` **immediately** (synchronous) | `true` if a request exists | `null`               | aborted; can never commit                |

Rationale for resetting on key change and idle (behaviour change, see §6): the brief ranks security and
predictable routing above stale-while-revalidate, and the admin's editor demonstrably misuses a previous
key's value. Same-key re-runs (`reload()`, the admin's post-save refresh bump) keep the value because it is
the same request. Errors from the current attempt are passed through unchanged (`ForgeApiError` instance,
`kind`, `status`, `code`, `details`); non-`Error` rejections are wrapped as before.

### 2. Cancellation (`packages/angular/src/resources.ts`)

```ts
function createResource<TRequest, TValue>(
  params: () => TRequest | undefined,
  keyOf: (request: TRequest) => string,
  load: (request: TRequest, signal: AbortSignal) => Promise<TValue>
): ForgeResource<TValue | undefined>;
```

- One `effect((onCleanup) => …)` tracks `params()`, the reload counter and the credential revision. Each run
  with a request creates one `AbortController`; `onCleanup` aborts it. Angular calls the cleanup before the
  next run (supersession, reload, idle, credential change) and when the owner is destroyed — no extra
  listeners or subscriptions exist to leak.
- `load` runs inside `untracked()` so signals read by the transport/config are not accidentally tracked.
- An attempt commits only if its controller is not aborted **and** the credential revision is unchanged
  (defensive: a custom transport may ignore the signal and resolve anyway; the revision can change before
  Angular re-runs the effect).
- `collectionResource` → `listDocuments(collection, query, { signal })`; `documentResource` →
  `getDocument(collection, id, depth ? { depth } : undefined, { signal })`. The signal reaches
  `ForgeTransportRequest.signal` (C01).
- No retry. `reload()` causes exactly one new attempt for the current params (none when idle); several
  `reload()` calls before the effect runs coalesce into one.

### 3. Credential boundary (internal, no new public export)

`credentials.ts` (new, not exported from `index.ts`):

```ts
export class ForgeCredentialBoundary {
  /** Changes when the identity Forge sends may have changed. Compared by reference. */
  readonly revision: Signal<object>;
  invalidate(): void;
}
export function credentialBoundary(api: CmsApiService<ForgeSchema>): ForgeCredentialBoundary;
```

- One boundary per `CmsApiService` instance (a module `WeakMap`, so no new public member and nothing for
  API-key-only consumers to bootstrap). The revision combines an internal epoch with the configured
  `authToken` **read reactively**: if `authToken` is a function that reads a signal, changing that signal is a
  credential change. A function backed by non-reactive storage cannot be observed (documented); the token
  value is never exposed — the revision is an opaque object.
- `ForgeAuthSession` calls `invalidate()` on every identity boundary it controls: successful `login`
  and `signup` (the cookie changed), every `logout` (success or failure — local identity is gone), the
  first `401` while authenticated (expiry), a failed `login`/`signup` that clears a previously known user, and
  a `refresh()` whose user id differs from a previously known one. The first bootstrap (`/me` from the
  unknown state) does **not** invalidate: the cookie did not change, so resources loaded during bootstrap
  already used it.
- A `401` observed while anonymous does not invalidate (no refetch loop).
- Resources read the boundary only through the injected `CmsApiService`; they never inject
  `ForgeAuthSession`.

### 4. Admin (narrow)

- `ForgeDocumentEditorComponent`: when the document identity (collection + id) changes, clear `dirty`,
  `saveError` and `fieldErrors` so A's state cannot carry into B or `new`. The editor already awaits the write
  before clearing `dirty`/navigating; a regression test pins it (failed create and update → no navigation,
  `dirty` kept, error shown, no refresh bump).
- `ForgeCollectionWorkspaceComponent`: no code change expected — it consumes the corrected resource.

### 5. Peer ranges (proved by §5a)

Candidates were derived from what each package imports and what its own peers allow, then run through
§5a. **Final** ranges (all proven):

| Package              | Peer                                                                                 | Range                  | Why / evidence                                                                   |
| -------------------- | ------------------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------- |
| `@forge-cms/angular` | `@angular/core`, `@angular/router`                                                   | `^21.0.0 \|\| ^22.0.0` | injectables only; `angular-min` (21.0.0) … `angular-22` (22.2.1)                 |
|                      | `@angular/compiler-cli` (opt, `/vite`)                                               | `^21.0.0 \|\| ^22.0.0` | the linker; same combinations                                                    |
|                      | `@babel/core` (opt, `/vite`)                                                         | `^7.28.0 \|\| ^8.0.0`  | Angular 21's linker: Babel 7 (7.28.0, 7.29.x); Angular 22's **requires** Babel 8 |
|                      | `vite` (opt, `/vite`)                                                                | `^7.0.0 \|\| ^8.0.0`   | 7.0.0, 7.1.4, 8.3.2                                                              |
| `@forge-cms/admin`   | `@angular/{core,common,forms,platform-browser,router}`, `@angular/compiler-cli`(opt) | `^21.2.0`              | VoltUI 1.x peers `@angular/* ^21.2.0`; 21.2.0, 21.2.10, 21.2.25                  |
|                      | `rxjs`                                                                               | `^7.8.0`               | 7.8.0, 7.8.2 (`map` + `toSignal`)                                                |
|                      | `@voltui/components`                                                                 | `^1.0.1`               | 1.0.1, 1.1.0 — the apps already ran 1.1.0 against the exact 1.0.1 pin            |
|                      | `lumen-icons`                                                                        | `^0.2.0`               | 0.2.0 (only release in range)                                                    |
|                      | `vite` (opt, linker)                                                                 | `^7.0.0 \|\| ^8.0.0`   | 7.0.0, 7.1.4, 8.3.2                                                              |
|                      | `@babel/core` (opt, linker)                                                          | `^7.28.0`              | 7.28.0, 7.29.0, 7.29.7 (admin is Angular 21 only)                                |

Angular 19/20 are not supported: VoltUI excludes them for admin, and nothing builds them.

**Reality found while proving the ranges (spec updated, see Outcome):** the `angular-*` combinations first
failed with partial-Ivy declarations (`ɵfac`/`ɵprov` with `minVersion`/`ngImport` metadata) left in the
production bundle. Analog's Vite plugin only links Angular Package Format files (`/fesm20/` paths);
Forge's packages are plain `ngc` output, so every Vite/Analog consumer needs a linker — and the only one
Forge shipped was `@forge-cms/admin/vite`, which drags in VoltUI and Angular `^21.2.0`. A Vite app using
only `@forge-cms/angular` therefore built a bundle that crashes with `JIT compiler unavailable` (a
pre-existing defect). Fix, the smallest that makes the advertised range true: the plugin moves unchanged to
a new subpath **`@forge-cms/angular/vite`** (optional peers above); `@forge-cms/admin/vite` re-exports it.

#### 5a. Strict packed-consumer compatibility matrix

`scripts/verify-angular-compat.mjs` (`pnpm release:compat`, CI `checks` job after `release:verify`), with
its pure checks in `scripts/angular-compat.mjs` (unit-tested by `scripts/angular-compat.test.mjs`). It packs
core/angular/admin itself. Each combination is an external Vite + `@analogjs/vite-plugin-angular` app
installed **only** from the tarballs (`pnpm.overrides` keep admin → angular → core on the tarballs), with an
`.npmrc` of `strict-peer-dependencies=true` and `auto-install-peers=false`. Per combination:

1. `pnpm install` in a fresh directory — any unmet/invalid peer fails. (A re-run with a lockfile skips
   resolution and therefore the peer check; the script never reuses a directory.)
2. **Single copy** — each Angular runtime package (`common`, `compiler`, `core`, `forms`,
   `platform-browser`, `router`) has exactly one pnpm store directory (one version under one peer set), and
   those plus `rxjs` resolve to one real path from the app, `@forge-cms/angular`, `@forge-cms/admin` and
   `@voltui/components`. `rxjs` is not store-checked: `@angular-devkit/*` pins a private build-time copy
   that never reaches the browser.
3. `tsc --noEmit` and `ngc` with `strictTemplates` on an app that uses the typed C02 client, typed
   `collectionResource`/`documentResource` in a template, six `@ts-expect-error` negatives, and (admin) the
   admin layout, content/auth routes and `forgeAuthGuard`.
4. `vite build` with `angularLinker()` from `@forge-cms/angular/vite` (angular-only) or
   `@forge-cms/admin/vite` (admin combinations — proves the re-export).
5. Bundle: no unlinked partial declaration (metadata signature), exactly one `getBaseHrefFromDOM`
   definition (the incident's crash site), no server marker/`defineCollection`.

Third-party requirements the strict install surfaced, satisfied in the consumer rather than ignored:
`@angular/cdk` (VoltUI → `ng-primitives` peer) for admin combinations, and `@emnapi/core`/`@emnapi/runtime`
(`@angular/build` → rolldown's WebAssembly binding). Neither is a Forge peer.

Combinations and the versions actually installed (2026-10-04):

| Id            | Packages        | Angular | `@angular/build` | TypeScript | rxjs  | Vite  | vite-plugin-angular | Babel  | VoltUI |
| ------------- | --------------- | ------- | ---------------- | ---------- | ----- | ----- | ------------------- | ------ | ------ |
| `angular-min` | angular         | 21.0.0  | 21.0.0           | 5.9.2      | 7.8.0 | 7.0.0 | 2.4.8               | 7.28.0 | —      |
| `admin-min`   | angular + admin | 21.2.0  | 21.2.0           | 5.9.2      | 7.8.0 | 7.0.0 | 2.4.8               | 7.28.0 | 1.0.1  |
| `current`     | angular + admin | 21.2.10 | 21.2.10          | 5.9.2      | 7.8.2 | 7.1.4 | 2.4.8               | 7.29.0 | 1.1.0  |
| `latest-21`   | angular + admin | 21.2.25 | 21.2.24          | 5.9.3      | 7.8.2 | 8.3.2 | 2.8.0               | 7.29.7 | 1.1.0  |
| `angular-22`  | angular         | 22.2.1  | 22.2.1           | 6.0.3      | 7.8.2 | 8.3.2 | 2.8.0               | 8.0.6  | —      |

Range combinations (`latest-21`, `angular-22`) resolve to the newest published version at run time and
print the installed versions. `@angular/build` uses the framework version when published, else the newest
patch of the same minor (there is no `@angular/build@21.2.25`).

**Negative evidence.** (a) `current` with the **old** exact pins fails the strict install
(`@voltui/components@1.0.1` vs 1.1.0, `rxjs@7.8.0` vs 7.8.2, `vite@7.0.0` vs 7.1.4). (b) An admin tarball
re-pinned to the incident's exact `@angular/* 21.2.0` against an app on 21.2.10 fails the strict install
with pnpm 10.11.0 and 10.18.3 (`unmet peer @angular/common@21.2.0: found 21.2.10`). A _lenient_ install of
the same no longer produces a second copy with pnpm 10 (it links the app's copy and warns), so the duplicate
detectors are proven on the incident's store layout and bundle shape by unit fixtures, not by a live
duplicate. (c) Without the linker, the angular-only bundles contained 9–10 unlinked declarations and failed
check 5.

### 6. Compatibility and semver

Public types of the main entries are unchanged (`check:api`: `@forge-cms/angular` 88 exports,
`@forge-cms/admin` 46, `@forge-cms/admin/vite` 1 — all unchanged). One intentional addition: the
`@forge-cms/angular/vite` subpath (`angularLinker`, new baseline). Behaviour changes fix undocumented, unsafe
behaviour: `value()` resets on key change, idle, failure and credential change; superseded requests are
aborted. Peers become ranges that include the previous exact pins (except where those pins were already
violated by the first-party apps).

**Patch** changeset in the fixed group. The subpath is additive and non-breaking, and it repairs a promise
the package already made (a Vite/Analog app can build `@forge-cms/angular` for production). Per ROADMAP's
version policy, npm `0.9.x` is the roadmap-0.8 line and `0.10.0` is reserved for 0.9 (SSR); a minor here would
spend that number on reliability work.

## Implementation plan

- [x] Spec (this file)
- [x] `credentials.ts` + `CmsApiService` registration; `ForgeAuthSession` invalidation
- [x] `resources.ts` rewrite of `createResource` (keys, abort, untracked load, commit guard, reset contract)
- [x] `resources.test.ts` — deterministic custom transport, TestBed effects (jsdom); includes the session
      credential-boundary cases
- [x] admin editor narrow change + `content-resources.test.ts` (workspace + editor)
- [x] `scripts/angular-compat.mjs` + `verify-angular-compat.mjs` + unit test; `release:compat`; CI step
- [x] `@forge-cms/angular/vite` (linker moved; admin re-exports); peer ranges from the matrix
- [x] README/guides/STATE/ROADMAP; changeset
- [x] Gates

## Test plan

- `packages/angular/src/resources.test.ts` (34): every row of §1 + A–E of the brief, with a custom transport
  whose responses the test settles, recording the `AbortSignal` it receives; by default the transport
  **ignores** abort, one case honours it like `fetch`. Session cases: bootstrap does not invalidate,
  A → logout (synchronous hide, in-flight ignored), failed logout, anonymous → login (anonymous 401 does not
  loop), logout → B, A → B without logout, 401 expiry, signup, failed anonymous login, refresh finding
  another user; static API key + `credentials: 'omit'`; signal-backed `authToken`. 20 of the 34 fail on the
  previous implementation.
- `packages/admin/src/content-resources.test.ts` (8): real workspace/editor components (white-box, TestBed)
  over a custom transport: fast status/sort/page changes, new query never shows old rows, logout → login as
  another user, A → B, edit → `new`, failed update (400 + field errors), failed create (500), successful save
  awaits the write. 5 of 8 fail on the previous implementation; the 3 save tests pin existing behaviour.
- `typed-client.test.ts` unchanged (C02 inference and `@ts-expect-error`s).
- `scripts/angular-compat.test.mjs` (9), `pnpm release:compat` (5 combinations), and the repository gates.

## Acceptance criteria

1. Superseded attempts receive an aborted `AbortSignal` at the transport.
2. A late result/error of a superseded or idle-invalidated attempt never changes any signal, even when the
   transport ignores the signal.
3. Request → `undefined` resets `value`/`error`, sets `isLoading(false)`, and the old attempt cannot repopulate.
4. Destroying the owner aborts the attempt and no signal changes afterwards.
5. A current failure surfaces the same `ForgeApiError` instance; an intentional abort never surfaces.
6. `reload()` aborts the active attempt, runs the current params once, keeps the same-key value while loading.
7. Logout / identity change hides the previous value synchronously; an attempt started under user A never
   commits after the switch; the resource reloads under the new identity.
8. API-key (`authToken` string and reactive function) and custom-transport flows keep working.
9. Failed admin create/update: no navigation, `dirty` kept, error visible, no refresh bump.
10. Peers are ranges; every combination in §5a installs strictly, builds, and passes the duplicate/bundle checks.
11. The duplicate check is proven to fail on the incident layout.
12. `typed-client.test.ts` and the typed packed consumer in `release:verify` stay green; `check:api` main
    entries unchanged (only the `@forge-cms/angular/vite` subpath added).
13. Patch changeset; STATE, ROADMAP, Angular guide and README describe the behaviour and the tested matrix.
14. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm check:api &&
pnpm release:verify && pnpm release:compat` and `pnpm e2e:www`, `pnpm e2e:demo`, `pnpm e2e:tiny-project`
    green. No SSR code.

## Open questions

None. (Angular 22 support for `@forge-cms/angular` is decided by the `angular-22` combination, not by
preference: if it fails, the range is `^21.0.0`.)

## Outcome

Shipped as designed, with one divergence found by the matrix (§5): Vite/Analog consumers of
`@forge-cms/angular` alone could not produce a working production build, so the existing linker plugin moved
to the new `@forge-cms/angular/vite` subpath (admin re-exports it) and `@babel/core` gained `^8.0.0` for
Angular 22. Test placement differs from the first draft: the session credential cases live in
`resources.test.ts`, and the admin cases in one `content-resources.test.ts`. The packing step is
self-contained in `verify-angular-compat.mjs` (no shared `release-pack.mjs`).

Evidence, executed on 2026-10-04 on this branch (local, macOS, Node 22.23.1, pnpm 10.11.0 in the
workspace / 10.18.3 in the temporary consumers):

- **Newly executed:** `pnpm format:check` (only the git-ignored local `.kilo/` worktree warns), `pnpm lint`,
  `pnpm typecheck`, `pnpm test` (incl. 26 script tests), `pnpm build`, `pnpm check:api`,
  `pnpm release:verify`, `pnpm release:compat` (5/5, run three times; table in §5a), `pnpm e2e:www` (25),
  `pnpm e2e:tiny-project` (13), `pnpm e2e:demo` (29), the negative runs in §5a, and the new tests against
  the old implementation (20/34 and 5/8 fail there).
- **Cached/reused:** the second lint/typecheck/test/build pass after doc and website edits replayed Turbo's
  cache for unchanged packages (`@forge-cms/www` re-ran). The first pass ran 10/25 test tasks from cache
  (packages untouched by this change).
- **Not run (by policy):** `pnpm test:cloudflare`, `pnpm test:libsql`, `pnpm test:upgrade` — no backend,
  runtime, auth, storage or schema code changed (QUALITY.md); CI runs them on the PR. `pnpm e2e:www:prod` —
  not in the requested gate list; CI runs it.
- **Pending:** CI on the PR; the release of the patch (`0.9.2`) after merge.
