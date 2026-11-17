# 106 — Ship certified login/signup throttles for both profiles

- **Status:** in-progress
- **Author:** agent draft (scope approved by the maintainer's 1.1.0 / V2-01 brief, 2026-11-17)
- **Date:** 2026-11-17
- **Branch:** `feat/admin-angular-22` (the single 1.1.0 PR, #127)
- **Affected packages/apps:** `@forge-cms/runtime` (new exports), `@forge-cms/cloudflare` (tests), `apps/demo-aesthetics`, `docs/examples/analog-quickstart`, docs
- **Release:** part of **1.1.0** (MINOR: new exports, no default change)

## Context / Why

Spec 069 added the `throttle` hook to `handleLogin`/`handleSignup`, with a 429 `RATE_LIMITED` response and `Retry-After`. Forge itself ships no limiter: the docs give a Cloudflare binding recipe and, for portable hosts, only "your limiter service". V2-01 asks for a documented, **tested** way to throttle on both profiles, wired into the quickstarts and the demo. The password work factor (spec 105) makes throttling more important, because every refused attempt saves one PBKDF2 derivation.

## Goal

Hosts on either profile throttle login/signup with a few lines of tested, documented code. The same keys and budgets are used everywhere, and nothing changes for hosts that do not opt in.

## Compatibility impact

**Backward compatible (MINOR).** New exports only: `DatabaseAuthThrottle`, `rateLimitBindingAuthThrottle` and the types `AuthThrottleLimit`, `AuthThrottleLimits`, `DatabaseAuthThrottleOptions`, `RateLimitBinding`, `RateLimitBindingAuthThrottleOptions` (`api-baseline/_forge-cms_runtime.json`). Handlers are unchanged: without `throttle` nothing is throttled. `_forge_auth_throttle` exists only when a host calls `DatabaseAuthThrottle.syncSchema()`. `ForgeCmsRuntime.syncSchema()` and the upgrade rehearsal's schema are untouched.

## Non-goals

- No default-on throttling (it would change documented behaviour).
- No in-process limiter: the docs keep warning against it, since it is per instance and forgets on restart.
- No sliding windows or token buckets. Fixed windows match Cloudflare's bindings and are easy to reason about.
- Not adding `@forge-cms/runtime` as a dependency of `@forge-cms/cloudflare`: the binding adapter takes a structural `RateLimitBinding`.

## Design

```ts
export interface AuthThrottleLimit {
  limit: number;
  windowSeconds: number;
}
export interface AuthThrottleLimits {
  loginClient?: AuthThrottleLimit;
  loginAccount?: AuthThrottleLimit;
  signupClient?: AuthThrottleLimit;
}
export interface DatabaseAuthThrottleOptions {
  database: DatabaseAdapter;
  clientKey?: (request: Request) => string; // or use forClient()
  limits?: AuthThrottleLimits; // defaults 10 / 30 / 10 per 60 s
}
export class DatabaseAuthThrottle {
  syncSchema(): Promise<void>;
  planSchema(): Promise<SchemaPlan>;
  readonly throttle: AuthAttemptThrottle; // keyed with clientKey(request); throws (→ 500) without one
  forClient(client: string): AuthAttemptThrottle; // the route knows the address (Node: getRequestIP)
  prune(max?: number): Promise<number>; // delete expired windows
}
export interface RateLimitBinding {
  limit(o: { key: string }): Promise<{ success: boolean }>;
}
export function rateLimitBindingAuthThrottle(o: {
  client: RateLimitBinding;
  account: RateLimitBinding;
  clientKey: (r: Request) => string;
  retryAfterSeconds?: number;
}): AuthAttemptThrottle;
```

- **Keys** (both implementations, as in the existing docs): `login:client:<client>` and `login:account:<email>` for login; `signup:client:<client>` for signup. The account budget is the larger one, so knowing an address is not enough to lock its owner out.
- **`DatabaseAuthThrottle`:** one row per key in `_forge_auth_throttle` (`windowStart`, `windowEnd`, `count`). The row id is `t1_` + SHA-256(key), so no email or address is stored. Fixed windows. The first attempt `create`s the row (a unique conflict means a concurrent first attempt, so it retries). A new window is a compare-and-set reset, and every increment is `updateIf(…, { targetMatches: { windowStart, count } })`. After 8 lost races the attempt is refused: under contention it brakes and never lets an attempt through. A refusal's `Retry-After` is the remaining window. `prune()` deletes expired rows with `deleteIf`; deleting a row only starts a fresh window, so it never exceeds a budget. Cost per checked attempt: one read and one write per key.
- **Client key.** There is no default. Cloudflare: `cf-connecting-ip`. Node: h3's `getRequestIP(event)` (the socket address; `{ xForwardedFor: true }` only behind a trusted proxy) through `forClient`.

## Wiring

| Where                                                       | Option                                                                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/examples/analog-quickstart` (Node, consumer-verified) | `DatabaseAuthThrottle` on the runtime's database; login uses `forClient(getRequestIP(event))`                                                                                  |
| `apps/demo-aesthetics` (Cloudflare Pages + D1)              | `DatabaseAuthThrottle` on D1 keyed by `cf-connecting-ip`, active only when the D1 binding exists. Local dev and e2e stay unthrottled (in-memory database, one client address). |
| Workers with bindings (docs, workerd test)                  | `rateLimitBindingAuthThrottle` over two Rate Limiting bindings                                                                                                                 |

## Implementation plan

- [x] `packages/runtime/src/auth-throttle.ts` + exports + `api-baseline`
- [x] runtime tests (InMemory + libSQL: budgets, windows, per-account, signup, concurrency, no plaintext, prune, schema plan, `forClient`, 429 through the handlers before any PBKDF2, the binding adapter)
- [x] workerd + local D1 tests (`DatabaseAuthThrottle` 429 and concurrency; the binding test now uses the exported adapter)
- [x] Analog quickstart + its docs snippet; demo wiring + test
- [x] docs: browser-auth "throttling", LIMITATIONS
- [x] changeset, STATE.md

## Test plan

`pnpm --filter @forge-cms/runtime test`, `pnpm test:cloudflare`, `pnpm docs:verify`, `pnpm docs:verify:consumers`, `pnpm check:api`, full gates, the e2e suites.

## Acceptance criteria

1. On InMemory, libSQL and workerd + D1, a budget of N admits exactly N of M concurrent attempts.
2. A refused login is `429 RATE_LIMITED` with `Retry-After`, and no PBKDF2 derivation runs.
3. Login is limited per client and per account; signup per client; keys are not stored in plaintext.
4. The binding adapter calls the documented keys and refuses when either budget is spent.
5. The Analog quickstart consumer passes with the throttle wired, and the demo throttles on its D1 profile.
6. Without `throttle`, behaviour is unchanged (existing spec 069 tests pass unmodified).

## Outcome

<!-- Fill when merged. -->
