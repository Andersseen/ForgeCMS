# 103 — Support Angular 22 in @forge-cms/admin

- **Status:** in-progress
- **Author:** agent draft (scope approved by the maintainer's 1.1.0 / V2-01 brief, 2026-11-17)
- **Date:** 2026-11-17
- **Branch:** `feat/admin-angular-22`
- **Affected packages/apps:** `@forge-cms/admin` (peer ranges only), `scripts/` (release:compat, packed SSR journey, release:certify), docs
- **Release:** part of **1.1.0** (MINOR, fixed group). First work item of V2-01 + Angular 22.

## Context / Why

`@forge-cms/admin` 1.0 peers `@angular/* ^21.2.0`, because VoltUI 1.x did. A real consumer (Analog 2.9.7, Angular 22.2.6, Vite 8, TypeScript 6.0, `@voltui/components` 1.3.3, zoneless, Cloudflare Workers + D1 + R2) needs to mount the admin. VoltUI 1.3.2 now peers `^21.2.0 || ^22.0.0`. `@forge-cms/angular` was already certified on Angular 22 (client only, spec 077 / `angular-22`).

## Goal

The packed `@forge-cms/admin` installs with strict peers, builds, server-renders and mounts on Angular 21.2+ **and** 22, and the gates prove both.

## Compatibility impact

**Backward compatible (MINOR).** Only peer ranges are widened; every range a 1.0 consumer satisfies is still accepted. No export, no REST envelope, no default changes (`api-baseline/*` unchanged). `@voltui/components` stays `^1.0.1`: versions below 1.3.2 do not _break_ on 22. They only declare a 21-only peer, which strict package managers enforce themselves. Raising the floor would narrow what Angular 21 users may install, so it is not done.

## Non-goals

- No support below Angular 21.2: VoltUI's peer floor is `^21.2`, the admin uses `linkedSignal` and the stable `provideZonelessChangeDetection`, and Angular 17–20 are past end of support.
- No change to the admin's source, templates or public API. (Accessibility work is spec 104.)
- No change to the repository's own apps' Angular version (`apps/*` stay on 21.2.10).
- Not waiting for `lumen-icons` 0.3 (see Design → lumen-icons). The maintainer decided on 2026-11-17 to proceed without it.

## Design

### Peer ranges (`packages/admin/package.json`)

| Peer                                                                    | 1.0       | 1.1                                |
| ----------------------------------------------------------------------- | --------- | ---------------------------------- |
| `@angular/{cdk,common,compiler-cli,core,forms,platform-browser,router}` | `^21.2.0` | `^21.2.0 \|\| ^22.0.0`             |
| `@babel/core` (optional, linker)                                        | `^7.28.0` | `^7.28.0 \|\| ^8.0.0`              |
| `lumen-icons`                                                           | `^0.2.0`  | `^0.2.0 \|\| ^0.3.0`               |
| `@voltui/components`                                                    | `^1.0.1`  | `^1.0.1` (unchanged; 1.3.2+ on 22) |
| `rxjs`, `vite`                                                          | unchanged | unchanged                          |

**Babel.** Angular 22.0.x's `@angular/compiler-cli` still depends on Babel 7.29; Babel 8 starts at 22.1. Both majors are therefore real for Angular 22, and the range covers both.

### lumen-icons

`lumen-icons` 0.3.0 (Angular 22 peer) is **not published** (npm has 0.1.0 and 0.2.0; 0.2.0 peers `@angular/{core,common} ^21.0.0`). The admin works with 0.2.0 on Angular 22 (proven below). A strict-peer pnpm install on 22 reports that one peer as unmet. The gates, and the documented workaround, tolerate exactly that peer:

```json
{
  "pnpm": {
    "peerDependencyRules": {
      "allowedVersions": {
        "lumen-icons>@angular/core": "^21.0.0 || ^22.0.0",
        "lumen-icons>@angular/common": "^21.0.0 || ^22.0.0"
      }
    }
  }
}
```

Report upstream to Lumen Icons: publish 0.3.0 with an Angular 22 peer. Then drop the exception (`lumenIconsException` in `verify-angular-compat.mjs`, `peerRules()` in `ssr-consumer/shared.mjs`) and add a 0.3 tuple.

### Gates

1. **`release:compat`** (`scripts/verify-angular-compat.mjs`). The existing `admin-min` (21.2.0), `current` (21.2.10) and `latest-21` (newest 21.2.x) tuples are kept. Two new tuples:
   - `admin-22-min`: Angular 22.0.0, cdk 22.0.0, VoltUI 1.3.2, lumen-icons 0.2.0, TS ~6.0, rxjs 7.8.0, Vite ^8, vite-plugin-angular ^2.8, **Babel 7.29.0**.
   - `admin-22`: newest of every range on Angular 22 (Babel ^8).

   The `@emnapi` WebAssembly-fallback exception (not a Forge peer) widens from the single version `2.0.0-alpha.3` to `>=2.0.0-alpha.0 <2.0.0-beta.0`, because newest `@angular/build` 22.2.6 ships alpha.6.

2. **Admin consumer fixture on 22 (build + SSR + mount).** The existing packed SSR journey (`scripts/ssr-consumer/journey.mjs`, the tiny-project admin mounted at `/studio`) becomes tuple-parametric:
   - `FORGE_SSR_TUPLE=angular-21` (default, unchanged) | `angular-22` (Angular 22.2.6, Analog 2.9.7, Vite 8.3.8, TS 6.0.3, Babel 8.1.2, VoltUI 1.3.3, cdk 22.2.7).
   - `FORGE_SSR_PROFILES=cloudflare` runs only the Cloudflare Pages output under local workerd + D1 + R2. That half needs no Docker/Garage, so it matches the real consumer's target. The default still runs both profiles.
   - New script `pnpm release:ssr:admin-22`, and a new `release:certify` stage `admin-22` (so `release` cannot publish without it). The Angular 21 journey keeps running on both profiles in the `s3` stage.
3. **Admin e2e + axe on 21 and 22.** The journey now runs WCAG 2.2 A/AA axe scans (same tag set and the same single documented `target-size` exclusion as tiny-project's golden path, spec 086) on `/studio/collections`, `/studio/collections/posts`, `/studio/users` and `/studio/login`, on whichever tuple it runs. The keyboard journey is spec 104.

## Implementation plan

- [x] widen the admin peers (`packages/admin/package.json`)
- [x] `release:compat`: `admin-22-min`, `admin-22`, the lumen-icons exception, the wider `@emnapi` alpha range
- [x] SSR consumer: `FORGE_SSR_TUPLE`, `FORGE_SSR_PROFILES`, `peerRules()`, axe scans in the journey
- [x] `release:ssr:admin-22` script + `release:certify` stage `admin-22`
- [x] docs: SUPPORT, LIMITATIONS "Admin framework", MATRICES "Angular admin", README baseline, admin README, REFERENCE, site docs (angular-client, angular-quickstart, troubleshooting)
- [x] changeset (minor, `@forge-cms/admin`)
- [x] full gates + STATE.md

## Test plan

- `pnpm release:compat` (all seven tuples)
- `pnpm release:ssr:admin-22` and `FORGE_SSR_TUPLE=angular-21 FORGE_SSR_PROFILES=cloudflare node scripts/verify-ssr-consumer.mjs journey`
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, `pnpm docs:verify`, `pnpm format:check`, public API check unchanged

## Acceptance criteria

1. `pnpm release:compat` passes `admin-min`, `current`, `latest-21`, `admin-22-min`, `admin-22` (plus the client-only tuples).
2. `pnpm release:ssr:admin-22` passes: strict install, fully linked browser + server bundles, SSR, admin mounted at `/studio`, the full journey, zero axe WCAG 2.2 A/AA violations.
3. The same journey with axe passes on Angular 21.2.10.
4. `api-baseline/*` unchanged; the gates are green.
5. SUPPORT.md no longer says the admin is unsupported on Angular 22 and lists the tested 22 tuples.

## Evidence (2026-11-17, local, macOS)

| Gate                          | Tuple                                                                                                                                            | Result            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| `release:compat admin-22-min` | Angular 22.0.0 · build 22.0.0 · TS 6.0.3 · rxjs 7.8.0 · Vite 8.3.8 · vite-plugin-angular 2.9.7 · Babel 7.29.0 · VoltUI 1.3.2 · lumen-icons 0.2.0 | passed            |
| `release:compat admin-22`     | Angular 22.2.6 · build 22.2.6 · TS 6.0.3 · rxjs 7.8.2 · Vite 8.3.8 · vite-plugin-angular 2.9.7 · Babel 8.1.2 · VoltUI 1.3.3 · lumen-icons 0.2.0  | passed            |
| `release:ssr:admin-22`        | Angular 22.2.6 · Analog 2.9.7 · workerd + D1 + R2                                                                                                | passed, axe clean |
| journey (Cloudflare)          | Angular 21.2.10 · Analog 2.5.2                                                                                                                   | passed, axe clean |

Findings during implementation: (a) `@voltui/components` < 1.3.2 cannot be installed on 22 with strict peers. (b) Angular 22.0.0 requires Babel 7 in the linker; the first attempt with Babel 8 failed with `Requires Babel "^7.0.0-0"`. (c) Newest `@angular/build` 22 pulls `@emnapi` 2.0.0-alpha.6.

## Upstream notes

- **Lumen Icons:** publish 0.3.0 with `@angular/{core,common}` `^21.0.0 || ^22.0.0` (or `^22`). Until then Angular 22 consumers need a peer rule.
- **Volt UI:** nothing blocking. 1.3.2+ works on 22.

## Outcome

<!-- Fill when merged. -->
