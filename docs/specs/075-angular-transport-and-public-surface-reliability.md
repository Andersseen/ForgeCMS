# 075 — Angular transport and public-surface reliability

- **Status:** in-progress (code done; production migration pending operator action)
- **Author:** agent draft
- **Date:** 2026-09-30
- **Branch:** feature/spec-075-angular-transport-public-reliability
- **Affected packages/apps:** @forge-cms/angular, @forge-cms/admin, apps/www, apps/demo-aesthetics,
  apps/tiny-project, apps/upgrade-rehearsal, CI, scripts

## Context / Why

Roadmap 0.8 starts with C01 ([0.8-angular-client.md](../roadmap/v1/0.8-angular-client.md)): the
Angular client hard-wired `fetch`, interpolated unencoded ids into URLs, lost HTTP status/code/details
on most failures, and `getCurrentUser()` turned any failure (500, offline) into "anonymous". Both public
Pages apps also answered HTTP 500 on every API route after spec 074, and only the demo had a
post-deploy check.

## Goal

A configurable, safe Angular transport with one structured error, dogfooded by the first-party apps,
and public deployments whose health is verified, diagnosable and not hidden.

## Non-goals

- C02 (schema-to-wire types; Finding 24 stays there) and C03 (stale-request/resource ownership).
- SSR, Strata, a second website redesign, retries of any kind, an interceptor framework.
- Resetting or reseeding production D1.

## Design

### Configuration (`provideForgeCms`, all optional)

| Option           | Default          | Notes                                                            |
| ---------------- | ---------------- | ---------------------------------------------------------------- |
| `baseUrl`        | `'/api/v1'`      | content; was required, now optional                              |
| `authBaseUrl`    | `'/api/auth'`    | login/signup/logout/me/users                                     |
| `credentials`    | `'include'`      | cookies for credential targets; `'omit'` = Bearer-only           |
| `authToken`      | none             | Bearer, only to credential targets, never on login/signup/logout |
| `trustedOrigins` | `[]`             | extra origins that may receive cookies/Bearer                    |
| `transport`      | `fetchTransport` | `(ForgeTransportRequest) => Promise<Response>`                   |

Credential targets: relative URLs, the page's own origin, `trustedOrigins`. Any other absolute origin
gets `credentials: 'omit'` and no `Authorization`. One joiner (`joinUrl`) trims only trailing slashes
of the base; each identifier goes through `encodePathSegment` (`encodeURIComponent`; empty, `.`, `..`
refused). Every method takes an optional last `{ signal }`.

### Errors

`ForgeApiError { kind: 'http' | 'network' | 'aborted' | 'invalid-response'; status?; code; details }`.
`ApiValidationError` (400 + field array), `ApiAuthError` (401, notifies listeners) and
`ApiAuthActionError` (login/signup/logout HTTP failures) are subclasses. A non-JSON error body keeps
`kind: 'http'` with its status and code `HTTP_ERROR`; its text is never copied. A 2xx that is not JSON
or lacks `{ data }` is `invalid-response`. No request is ever retried.

### Session

`/me` 401 → `null`/`anonymous`; 403/5xx/network/malformed → throws → `status() === 'error'`. 403
never signals expiry. Failed `logout()` → user cleared, `anonymous`, `error()` keeps the failure.

### Public surfaces

- App routes decode params with `decodeURIComponent` (`routeParam`).
- Runtime startup stages (`auth`, `configuration`, `database`, `seed`) are classified without secrets;
  a failed startup is not cached; `/api/status` answers 503 `RUNTIME_STARTUP_FAILED` with stage/reason.
- `scripts/verify-deployment.mjs www|demo`: bounded attempts, timeout, per-endpoint validators, safe
  failure text, runbook link. CI runs it after both deploys, after a secret-name preflight.
- Lumea public pages share one unavailable/Retry state; a detail outage is never "not found".
- www: hero min-width fix at 390px, canonical/OG per route, route titles, roadmap 0.8 in progress.

## Test plan

`packages/angular/src/transport.test.ts` (URL, encoding, credentials, error table, `/me`, logout,
no-retry); `apps/tiny-project/src/tests/custom-mount.integration.test.ts` (real HTTP under
`/content-api` + `/account-api`); `apps/demo-aesthetics/src/tests/startup.test.ts`;
`scripts/verify-deployment.test.mjs`; demo e2e (failure states, responsive, console);
`apps/www/e2e-prod` (production build under workerd).

## Acceptance criteria

1. C01 criteria 1–20 of the task brief — covered by the tests above.
2. Both deploy jobs fail when their API is unhealthy.
3. Remote `/api/status` is 200 on both projects **or** recorded as pending operator action.
4. Full gates green.

## Open questions

None.

## Outcome

Code complete on the branch. Production root cause: blocking schema drift (not `AUTH_SECRET`, which
both projects have) — demo `media._storageKey`, www `posts._status`. Reviewed migrations written,
backed up and rehearsed locally; the demo build on the migrated copy passes the health gate. Applying
them to production is **pending operator action** (see [DEPLOYMENT-HEALTH.md](../DEPLOYMENT-HEALTH.md)).
