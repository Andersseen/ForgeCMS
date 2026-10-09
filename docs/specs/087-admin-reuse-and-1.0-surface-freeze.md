# 087 — Certify admin reuse and freeze the 1.0 surface (roadmap 0.11 / U03)

- **Status:** done (2026-10-09)
- **Author:** agent draft (implementation requested by the maintainer, 2026-10-09 — "spec 087 — roadmap 0.11 / U03";
  per [SDD.md](../SDD.md) an explicit request to implement counts as approval)
- **Date:** 2026-10-09
- **Branch:** feature/spec-087-admin-reuse-surface-freeze
- **Affected packages/apps:** `packages/admin` (mount root, layout, sign-in/up, auth routes, collections index, config,
  default nav; tests), `packages/angular` (guard test only), `apps/tiny-project` (now mounted at `/studio` with
  non-default APIs; e2e), `apps/www` (explicit nav), `scripts/` (packed compat fixture, packed production journey), docs,
  changeset.

## Context / Why

U01 made content state reliable and U02 made the admin operable by keyboard. Both certified the admin **mounted at
`/admin` with `/api/v1` and `/api/auth`**. The package nevertheless claims reuse: its route helpers are relative and
`provideForgeCms()` takes any API base. U03 is the last packet before 1.0 certification: prove that claim in an
external-style consumer at a non-default mount, remove the `/admin` assumptions found, and review every public
admin/client integration contract before it becomes 1.0 API.

## Goal

A new Angular/Analog consumer using only packed public ForgeCMS packages can mount the reusable admin at a
consumer-selected route instead of `/admin`, point it at consumer-selected content and auth API prefixes instead of
`/api/v1` and `/api/auth`, bootstrap/sign in, manage content and users, exercise real role boundaries, refresh/deep-link
within the mounted admin, and complete the product journey without private imports or copied admin orchestration. The
resulting public admin/client route, configuration, export and peer contracts are reviewed and frozen for 1.0.

## Non-goals

No admin redesign, dashboard, field kind, richtext editor, bulk actions, saved filters, plugin system, CLI, deployment
provider, backend workflow, Angular 22 admin support, arbitrary route/config DSL, `provideForgeAdmin()` / admin service /
global store, all-in-one `forgeAdminApplication()`, R01 candidate certification, or remote infrastructure.

## Evidence gathered before design

- `rg '/admin|/api/'` over `packages/admin/src` and `packages/angular/src` (non-test): the `/admin` literals listed in
  the audit below; **no** `/api/*` literal in admin code (all requests go through `CmsApiService`; now pinned by a
  test).
- Real router behaviour (`custom-mount.test.ts` drives `RouterTestingHarness` with `withComponentInputBinding()`): route
  `data` binds only to the route's **own** component, so a `data.config` on the layout route never reached
  `ForgeCollectionsIndexComponent` (a non-empty child route) — `ForgeAdminConfig.collections` was silently ignored through
  the public route helpers.
- `apps/tiny-project`'s `provideForgeCms({ credentials: 'omit' })` on the public route subtree **replaces** the app
  config (it does not merge), so moving the app-level bases silently left the public pages on `/api/v1`. The fixture
  now repeats the bases; documented in the surface doc.
- Analog routes only `src/server/routes/<apiPrefix>/**` (default `api`) to Nitro in dev and production, so the
  certified consumer's non-default prefixes are `/api/content` and `/api/account`. The literal `/content-api` +
  `/account-api` prefixes remain certified by the real-HTTP test (below), which is not an Analog app.

## Audit (before changes)

| Surface                                                | Finding                                                                                                                                                                                                                 | Decision                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `@forge-cms/admin` export names                        | 46 names, all intentional; analytics are experimental                                                                                                                                                                   | FREEZE AS-IS (analytics: EXPERIMENTAL)                 |
| `@forge-cms/admin/vite`, `@forge-cms/angular/vite`     | One plugin, two import paths; docs told consumers to copy a private plugin                                                                                                                                              | FREEZE AS-IS; FIX docs                                 |
| `@forge-cms/angular` exports used by admin             | `ForgeAuthSession`, `CmsApiService`, `forgeAuthGuard`, `provideForgeCms`, `canManageUsers`, `userRole`                                                                                                                  | FREEZE AS-IS                                           |
| `provideForgeCms()` / `ForgeCmsConfig`                 | Single client transport config; defaults `/api/v1`, `/api/auth`, `include`                                                                                                                                              | FREEZE AS-IS (no admin-level API URL)                  |
| `forgeAuthGuard()` / `ForgeAuthGuardOptions`           | `signInPath`/`forbiddenPath` already express any mount                                                                                                                                                                  | FREEZE AS-IS (no new option)                           |
| `forgeAdminContentRoutes()`                            | Relative; zero options                                                                                                                                                                                                  | FREEZE AS-IS                                           |
| `forgeAdminAuthRoutes()`                               | Relative, but pages hardcoded `/admin` for landing and `returnUrl`                                                                                                                                                      | FIX BEFORE FREEZE (`basePath` option)                  |
| `forgeAdminAnalyticsRoutes()`, analytics component/API | Marked experimental/opt-in                                                                                                                                                                                              | EXPERIMENTAL — outside the 1.0 guarantee               |
| `ForgeAdminLayoutComponent`                            | `signInPath` default, breadcrumbs, route matching (`startsWith('/admin/…')`) hardcoded                                                                                                                                  | FIX BEFORE FREEZE                                      |
| `ForgeSignInComponent` / `ForgeSignUpComponent`        | Fallback/landing `/admin`; `returnUrl` validated against `/admin` only                                                                                                                                                  | FIX BEFORE FREEZE                                      |
| `safe-redirect.ts` (internal)                          | `ADMIN_ROOT = '/admin'`                                                                                                                                                                                                 | FIX; stays INTERNAL (not exported)                     |
| `ForgeAdminConfig.title`, `.nav`, `.signInPath`        | Used                                                                                                                                                                                                                    | FREEZE AS-IS (+ `signInPath` default from mount)       |
| `ForgeAdminConfig.collections`                         | Used, but only if the config reaches the index (it did not through routes); typed `CollectionDefinition[]` invited server schema into the browser; `@forge-cms/core` was an undeclared type import of the admin `.d.ts` | FIX (propagation) + widen to `ReadonlyArray<{ slug }>` |
| `ForgeAdminConfig.logo`, `.features`                   | Never read anywhere                                                                                                                                                                                                     | DEPRECATE (no-op), keep keys; remove after 1.0         |
| `ForgeAdminNavItem/Group`, `adminOnly`                 | Used by the sidebar                                                                                                                                                                                                     | FREEZE AS-IS                                           |
| `DEFAULT_ADMIN_NAV`                                    | Linked Dashboard, Media, API, Settings that the package never mounts                                                                                                                                                    | FIX BEFORE FREEZE (package-owned destinations only)    |
| Component input defaults (U01/U02)                     | All optional, additive                                                                                                                                                                                                  | FREEZE AS-IS                                           |
| Peers                                                  | admin `^21.2.0` family incl. `@angular/cdk`; angular `^21 \|\| ^22`                                                                                                                                                     | FREEZE AS-IS (no broadening)                           |
| Layout "Exit" link (`/`)                               | Host root; not an admin path                                                                                                                                                                                            | NO CHANGE NEEDED                                       |
| `ForgeUsersWorkspaceComponent`                         | Public; mount-agnostic                                                                                                                                                                                                  | FREEZE AS-IS                                           |

## Design

### One concept: `basePath`

`ForgeAdminConfig.basePath?: string` and `ForgeAdminAuthRoutesOptions.basePath?: string`, default `/admin`. Chosen over
`mountPath`/`adminPath` because Angular's own vocabulary and `<base href>` make "base path" the least surprising word;
only this one name exists. It is the same value spelled where a URL is named: the layout config (breadcrumbs,
default nav, sign-in path), the auth routes (pages' landing and `returnUrl` boundary), and the guard's existing
`signInPath`/`forbiddenPath`. No provider/service is added: the pages sit **outside** the layout, so a layout-scoped
channel could not reach them, and route data is already the established channel (`signUpPath`, `config`).

`mount-path.ts` (internal): `parseAdminBasePath` accepts same-app absolute paths (`/studio`, `/ops/cms/`), rejects
non-absolute, `//`, URLs, `?`/`#`/`\`, whitespace/control characters, `.`/`..`/empty segments and bare `/`;
`isUnderPath(pathname, root)` is exact-or-`/`-continued (so `/studio-evil` is not under `/studio`). Components fall back
to `/admin` on an invalid value; `forgeAdminAuthRoutes` **throws** (fail at route-build time).

### Safe redirect

`safeAdminRedirect(value, fallback = '/admin', root = '/admin')` keeps spec 056's checks (leading `/`, not `//`, no
backslash/control characters, same-origin after `URL` parsing) and tests the **normalised** pathname against `root`
(so `/studio/../admin` is rejected). Default behaviour is unchanged.

### Layout

Breadcrumbs derive from the router URL signal and `basePath`; sections match by `isUnderPath`, not `startsWith`.
`signInPath` defaults to `{basePath}/login`. The default nav is generated from `basePath` (`adminNavFor`, internal);
`DEFAULT_ADMIN_NAV` stays the exported `/admin` instance.

### Default navigation (frozen)

Collections (`forgeAdminContentRoutes()`) and admin-only Users (host mounts `ForgeUsersWorkspaceComponent`). Nothing
else; no placeholder pages. A host with a dashboard/media/settings page lists them (`apps/www` does). Because a host
relying on the old default would see links disappear, the changeset is a **minor**, not a patch.

### Config propagation

`ForgeCollectionsIndexComponent` uses its `config` input, else the nearest ancestor `data.config` from the activated
route snapshot — the same data the layout binds, so a host sets it once. Chosen over repeating config on every nested
route or a global store.

## Implementation plan

1. Spec, audit; pin the failures with tests (`custom-mount.test.ts`, `safe-redirect.test.ts`).
2. `mount-path.ts`, `safe-redirect.ts`, `config.ts`, layout, sign-in/up, auth routes, collections index.
3. Tiny-project: mount at `/studio`, APIs at `/api/content` + `/api/account`; move the file routes; e2e additions.
4. `apps/www`: explicit nav. Demo-aesthetics unchanged (explicit nav + `signInPath`).
5. Packed compat fixture (non-default mount/APIs + legacy composition), packed production journey step.
6. Surface inventory, migration notes, admin docs; STATE/ROADMAP/0.11.

## Test plan

- Unit: `mount-path.test.ts`, `safe-redirect.test.ts` (custom root cases), `auth-routes.test.ts`,
  `custom-mount.test.ts` (real router: layout links/breadcrumbs/Log in, sign-in/up landing and `returnUrl`, config
  propagation), `surface-contract.test.ts` (frozen signatures, legacy composition), `no-hardcoded-api.test.ts`,
  `auth-guard.test.ts` (custom mount through existing options).
- Browser (tiny-project, real server): shell/nav/breadcrumb hrefs, refresh of every nested route, `returnUrl` restore and
  refusal, content journey with public reads at each step, role matrix with direct HTTP denials, users workspace edit
  and delete, last-admin 409s, invalidated session (second actor rotates the password).
- Real HTTP `/content-api` + `/account-api`: existing `custom-mount.integration.test.ts` (kept).
- Packed: `pnpm release:compat` (strict Angular matrix with a `/studio` + custom-API admin fixture and the legacy
  composition), `pnpm test:s3 profiles` (production-built tarball consumer on Node+libSQL+S3 and Cloudflare/workerd
  walks `/studio`, refreshes, links, redirects; bundle scan for server code and secrets).

## Acceptance criteria

See the Outcome — every item of the U03 brief is accounted for there.

## Open questions

None blocking. Admin on Angular 22 stays out of scope (VoltUI 1.x).

## Outcome

**Release truth.** Started from main `b616005` (PR #86 merge); PR #86's main CI `37904507111` completed ✓. Published at
start: `0.12.0`; during the task Version Packages PR #87 (U02 patches) merged and `0.12.1` was published (npm + GitHub
release, verified) — the end state. The U03 changeset is an `@forge-cms/admin` **minor** (default nav shrank, `collections`
literal typing narrowed), so the next release is **`0.13.0`**. `CURRENT_FORGE_VERSION` updated to `0.12.1` (published).

**Mount and endpoints.** Admin certified at `/studio` (tiny-project) with `/api/content` + `/api/account`
(Analog serves only `/api/**` through Nitro; a literal `/content-api`/`/account-api` Analog route is unreachable). Those
literal prefixes stay certified over real HTTP by the kept `custom-mount.integration.test.ts`. `/admin` + `/api/v1`
remain defaults (apps/www, demo-aesthetics unchanged and green).

**`/admin` assumptions found → resolution.** `safe-redirect` `ADMIN_ROOT` → `root` parameter; layout `signInPath`
default, breadcrumb root and `startsWith('/admin/…')` matching → `basePath` + `isUnderPath`; `DEFAULT_ADMIN_NAV`
absolute `/admin/…` links → generated from `basePath` and cut to package-owned destinations; sign-in/sign-up `/admin`
fallbacks → `basePath` input fed by auth-route data; guard defaults → unchanged, custom mounts use the existing
`signInPath`/`forbiddenPath` (no new guard option).

**Final contracts.** Mount root: one name `basePath`, default `/admin`, same-app absolute path, nested allowed, trailing
slash ignored, exact-or-`/`-child matching, invalid → default (components) / throw (`forgeAdminAuthRoutes`). Safe redirect:
spec 056 checks + normalised-path under root. Guard composition and auth-route composition: see the surface doc.
Default nav: Collections + admin-only Users. No provider/service added.

**ForgeAdminConfig audit.** `title`, `nav`, `signInPath` used (keep); `basePath` added; `collections` used but never
received through route helpers → propagation fixed (nearest ancestor `data.config`) and type widened to
`ReadonlyArray<{ slug }>` (also removes an undeclared `@forge-cms/core` type dependency from the admin `.d.ts`); `logo`,
`features` never read → deprecated no-ops, kept to avoid a breaking removal. Browser bundle scan (packed production
journey, Node and Cloudflare profiles) found no server code, secret or database driver.

**Evidence (newly executed unless noted).** Unit: admin 208 tests (new: mount-path, safe-redirect custom root,
auth-routes, custom-mount via real router incl. propagation, surface-contract, no-hardcoded-api); angular guard
custom-mount case. tiny-project e2e 27 passed: first admin → sign-in → relation → draft hidden → publish → public read →
edit → fresh read → delete → absence; users create/edit/delete; last-admin 409 (demote/delete) over direct HTTP; generic
users mutation 403 `AUTH_MANAGED_COLLECTION` (kept); role matrix (editor/viewer UI hidden + direct 403s, safe envelope, no
`passwordHash`/`_sessionVersion`); invalidated session (second actor rotates password → real 401 → `session expired`,
input kept, `/studio/login`, re-sign-in); deep-link refresh of `/studio`, `/studio/collections`, `…/posts`, `…/posts/<id>`,
`/studio/users`; returnUrl restore and refusal of external/`//`/`/admin/…`/`/studio-evil`; no `/admin` navigation.
U01/U02 reliability, keyboard and axe tests unchanged and green. Packed: `pnpm release:compat` passed all five rows
(angular-min 21.0.0, admin-min 21.2.0, current 21.2.10, latest-21 21.2.25, angular-22 22.2.2 with Angular-only; admin
fixtures use `/studio`, custom API bases and the legacy composition); `pnpm test:s3` (Docker via Colima, all stages
incl. `profiles`) passed — the production-built tarball consumer on Node+libSQL+S3 and Cloudflare workerd+D1+R2 walks
`/studio` (refresh, in-mount links, redirects, no `/admin`/`/api/v1`/`/api/auth` request). `release:verify`,
`release:ssr`, `check:api` (baseline unchanged — no new exports), `test:libsql`, `test:cloudflare`, `test:upgrade`,
`lint`, `typecheck`, `test`, `build`, `e2e:www` (41), `e2e:www:prod` (11), `e2e:demo` (32) passed. `format:check` warns only
about three files inside an unrelated untracked `.kilo/worktrees` directory.

**Docs.** admin-ui, browser-auth, small-project-guide, admin README updated (no private linker, users workspace is
public, custom mount); `docs/1.0-PUBLIC-SURFACE.md` created (inventory, experimental analytics, peers, final defaults,
migration notes, freeze policy). Roadmap 0.11 marked complete; R01 not started.

**Left for R01.** Re-run the matrix from the packed release candidate; admin on Angular 22 stays unsupported.
