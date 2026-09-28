# 069 — Bound authentication abuse and certify the auth surface

- **Status:** done <!-- roadmap 0.6 H04, requested by the maintainer after spec 068 -->
- **Author:** agent draft
- **Date:** 2026-09-28
- **Branch:** `feature/spec-069-auth-abuse-bounds`
- **Affected packages/apps:** @forge-cms/auth, @forge-cms/runtime, @forge-cms/angular (test only),
  @forge-cms/cloudflare (tests only), apps/www, apps/tiny-project, apps/demo-aesthetics, docs

## Context / Why

H04 is the last open roadmap 0.6 packet: bounded auth inputs, clear failures, a supported throttling
control and regression evidence for secrets, cookies, CSRF and logs.

**Reproduced first** (a throwaway probe against the unfixed code, InMemory):

|     | Finding                                                   | Probe result                                                                                                                          |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A   | `handleLogin` read the body with `request.json()`         | a 5 MiB streamed body was read to the end (5,242,880 bytes pulled), then `401`                                                        |
| A2  | a JSON `null` body                                        | `500 INTERNAL_ERROR` (`null['email']` threw)                                                                                          |
| B   | no password maximum                                       | a 1,000,000-character login password was imported as a 1 MB PBKDF2 key; signup accepted and hashed one                                |
| C   | missing-user login                                        | unknown email: **0** PBKDF2 derivations; known email + wrong password: **1**                                                          |
| D   | no throttle contract                                      | nothing between the parsed body and `auth.login`                                                                                      |
| E   | apps ran `devMode: !env?.AUTH_SECRET`                     | with the secret missing, an admin token forged with the **public** dev secret validated (`role: admin`); `AUTH_SECRET=x` was accepted |
| F   | no credential size bound                                  | a 10 MB signed token reached HMAC verification; a 5 MB API-key id reached `findById`                                                  |
| G   | `toErrorResponse` logged the raw error                    | a driver error quoting the password appeared in the log                                                                               |
| —   | first-party `/api/auth/users*` and `/api/bootstrap-admin` | `h3.readBody` (unbounded), and the users routes read it **before** the admin check                                                    |

Benchmark (Node 22, PBKDF2-SHA256, 100,000 iterations): ~7 ms per derivation; a 16-character,
1,024-character and 1,000,000-character password took 6.8 / 6.8 / 7.6 ms. PBKDF2's HMAC hashes an
over-long key once, so password length costs memory and buffering far more than derivation time.

## Goal

No expensive credential operation receives unbounded input, hosts have one explicit login/signup
throttle, production can never sign with the public dev secret, and the auth surface's behaviour is
pinned by tests.

## Non-goals

Password reset, email verification, OAuth/OIDC, MFA, passkeys, magic links, CAPTCHA, invitations,
organisations, bot detection, a Forge rate limiter (in-memory or distributed), a CSRF-token framework,
cross-site cookies, a new hash format, and changing signup's `409` for a registered email. Roadmap 0.7
(M01) is not started.

## Design

### 1. Support matrix

| Operation            | Input bound                                           | Credential bound              | Throttling                                         | Failure                       | Discloses account?            | CSRF                            | Surface        |
| -------------------- | ----------------------------------------------------- | ----------------------------- | -------------------------------------------------- | ----------------------------- | ----------------------------- | ------------------------------- | -------------- |
| login                | body 8 KiB; password ≤ max                            | —                             | host hook, once per attempt, before lookup         | 401 generic / 400 / 413 / 429 | no                            | no (carries its own credential) | public         |
| signup               | body 8 KiB; email ≤ 254, name ≤ 256, password min–max | —                             | host hook before hashing; not called when disabled | 400 / 409 / 413 / 429 / 404   | yes, `409` (product contract) | no                              | public, opt-in |
| logout               | no body read                                          | cookie as sent                | none                                               | 403 cross-site                | no                            | yes                             | public         |
| me / session         | —                                                     | signed token ≤ 8192           | none                                               | 401                           | no                            | n/a (GET)                       | public         |
| trusted `createUser` | same as signup                                        | —                             | caller's                                           | result reason                 | caller's                      | route's                         | trusted server |
| trusted `updateUser` | email, name, password as above, before hashing        | —                             | caller's                                           | `UserMutationError`           | —                             | route's                         | trusted server |
| API-key auth         | —                                                     | ≤ 128 chars after `<prefix>_` | none (platform)                                    | 401                           | no                            | not for Bearer                  | machine        |
| signed-token auth    | —                                                     | ≤ 8192 chars                  | none (platform)                                    | 401                           | no                            | not for Bearer                  | any            |

### 2. Bounded body — `readBoundedJsonObject(request, { maxBytes })` (`@forge-cms/runtime`)

1. A valid `Content-Length` above the bound → `413` before any read.
2. The stream is read chunk by chunk; past the bound the reader is cancelled → `413`.
3. Fatal UTF-8 decode, `JSON.parse`, plain object required → otherwise `400 INVALID_INPUT`.

Web Streams only. Default `DEFAULT_AUTH_MAX_BODY_BYTES = 8192`: a 1024-character password is at most
3 KB of UTF-8, an email 254 and a name 256 characters, so a legitimate body is a fraction of it.
`maxBodyBytes` (1 byte – 1 MiB) exists for hosts that raise `passwordPolicy.maxLength`.

**Where the stream cap applies.** Hosts that hand Forge the platform `Request` (Workers, Hono, Deno,
Bun) get the streaming cap. Nitro 2's Cloudflare entries buffer the whole body
(`await request.arrayBuffer()`) before any route runs, so on the first-party Pages apps the outer bound
is Cloudflare's request limit (100 MB on Free/Pro) and Forge's bound governs what reaches parsing and
hashing. h3 1.15's Node adapter builds a body stream without a `cancel` handler, so a cancelled body
made the next `data` event throw an uncaught exception (seen in the E2E dev server). The apps use
`toCancellableWebRequest`, a pull-based stream that keeps the socket paused until a reader asks for
bytes and discards the rest after a cancel; a route that never reads the body buffers nothing.

An invalid `maxBodyBytes` is resolved before the handler's error mapping, so it throws a configuration
error with its message rather than becoming a redacted `500` on every request.

### 3. Errors

`ForgeErrorCode` gains `PAYLOAD_TOO_LARGE` (`PayloadTooLargeError`, 413, "Request body is too large")
and `RATE_LIMITED` (`RateLimitedError`, 429, "Too many authentication attempts", optional
`retryAfterSeconds`). Canonical envelope; no body contents in any message.

| Scenario                                              | Status | Code                |
| ----------------------------------------------------- | -----: | ------------------- |
| invalid login credentials                             |    401 | `UNAUTHORIZED`      |
| malformed / non-object JSON, missing fields           |    400 | `INVALID_INPUT`     |
| oversized auth body                                   |    413 | `PAYLOAD_TOO_LARGE` |
| signup: invalid email / name, password outside policy |    400 | `INVALID_INPUT`     |
| duplicate signup email                                |    409 | `UNIQUE_CONSTRAINT` |
| throttled login/signup                                |    429 | `RATE_LIMITED`      |
| disabled signup                                       |    404 | `NOT_FOUND`         |
| CSRF rejection                                        |    403 | `FORBIDDEN`         |
| missing/invalid/expired session                       |    401 | `UNAUTHORIZED`      |
| auth infrastructure or throttle failure               |    500 | `INTERNAL_ERROR`    |

### 4. Passwords (`PasswordPolicy` in `@forge-cms/auth`)

`maxLength` joins `minLength`. One length definition for both: JavaScript string length (UTF-16 code
units), which is what `minLength` already used. Default 1024; configuration must be integers with
`1 ≤ minLength ≤ maxLength ≤ 4096`, else the constructor throws. Never truncated.

- create / signup: outside the policy → `weak-password` before hashing.
- `updateUser`: outside the policy → `UserMutationError('weak-password')` before hashing or writing.
- login: longer than `maxLength` → `invalid-credentials` before any lookup or PBKDF2.

**Legacy passwords.** No maximum existed before. A stored password above 1024 characters (none is
realistic) would stop logging in; raising `maxLength` (up to 4096) restores it, and
`updateUser(id, { password })` resets it. Lowering `maxLength` has the same effect on longer passwords.

Emails are bounded at 254 characters (`invalid-email`) and names at 256 (`invalid-name`, a new
`AuthFailureReason` and `UserMutationFailureReason`), because both travel inside every session token.
`updateUser` now validates an email it is given (format and length) instead of storing it unchecked.

### 5. Verification parity

`login` verifies exactly once whatever happens: against the stored hash, or — when no row or no hash
matches — against `DUMMY_PASSWORD_HASH`, a real PBKDF2 hash in the stored format of a random password
that was discarded. No row is created, nothing is written, no salt is generated. The guarantee is that
Forge does not skip the password work for unknown accounts; database-dependent timing is not made
constant.

### 6. PBKDF2 work factor (audit)

PBKDF2-HMAC-SHA256, 100,000 iterations, 16-byte salt, 256-bit output. OWASP's current guidance for
this construction is 600,000. Accepted for 1.0 because:

- ~7 ms of CPU per verification (Node 22); 600,000 would be ~40 ms, beyond the Workers Free plan's
  10 ms CPU per request, on every login.
- Changing it without breaking stored hashes needs a versioned hash format with verify-legacy and
  rehash-on-login. That is a named post-1.0 follow-up, not H04.
- Throttling, not the work factor, is what bounds online guessing.

Local workerd was probed: it runs 100,000 iterations and does **not** cap higher counts (an assumed
100,000 cap turned out false and is recorded as such in the test).

### 7. Throttle hook (`@forge-cms/runtime`)

```ts
export interface AuthAttempt {
  action: 'login' | 'signup';
  identifier: string; // submitted email, trimmed + lower-cased
  request: Request;
}
export type AuthAttemptDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds?: number };
export type AuthAttemptThrottle = (
  attempt: AuthAttempt
) => AuthAttemptDecision | Promise<AuthAttemptDecision>;

interface AuthHandlerOptions {
  // …existing
  throttle?: AuthAttemptThrottle; // login/signup only
  maxBodyBytes?: number; // login/signup only
}
```

Order in `handleLogin`/`handleSignup`: _(signup: `enabled` / adapter support → 404, nothing read)_ →
bounded parse (413/400) → fields present (400) → **throttle** (429) → `auth.login`/`auth.signup` →
response. The throttle sees the same arguments for existing and unknown accounts. `Retry-After` is
emitted only for a finite value > 0, rounded up and capped at 86,400. A throw or a malformed decision
fails closed (`500`). It lives in `@forge-cms/runtime` because it needs the HTTP `Request` and is
invoked by the HTTP handlers; `@forge-cms/auth` does not depend on the runtime. Trusted server code
calling `auth.login` directly applies its own policy.

**Cloudflare.** Verified against Cloudflare's docs on 2026-09-28: the Workers Rate Limiting binding is
`ratelimits: [{ name, namespace_id, simple: { limit, period: 10 | 60 } }]` and
`await env.X.limit({ key })` → `{ success }`; counters are per location and eventually consistent; the
docs recommend user/tenant keys over IPs. Pages Functions do not list this binding, so a Pages project
uses a WAF rate limiting rule (Free: one rule, 10 s period, per IP) or a Worker. The wiring is a
documented host function, not a `@forge-cms/cloudflare` export: a client bucket for every attempt plus
an account bucket for login, because a limit keyed only on the submitted email lets anyone lock a known
account out, and signup spam picks a new email each time. That exact function ran against Miniflare's
local emulation in workerd; Cloudflare's remote service was **not** exercised.

**Portable hosts.** Proxy/ingress limits, framework middleware or an external limiter behind the same
hook. No in-memory production limiter is shipped or recommended.

### 8. Secrets

`resolveSigningSecret` (shared by `UsersCollectionAuthAdapter` and `SignedTokenAuthAdapter`):

- secret present, not `devMode` → at least `MIN_SIGNING_SECRET_BYTES = 32` UTF-8 bytes (the
  HMAC-SHA256 output size, RFC 2104's minimum recommendation), else throw;
- secret absent → `devMode: true` uses the public dev secret, otherwise throw;
- `devMode` accepts any provided secret.

Errors never contain the secret. The three apps now pass `devMode: import.meta.dev === true`. Nitro
replaces it at build time (checked in nitropack 2.13.4's rollup config and in tiny-project's built
worker, where it compiles to `!1`), so it is `true` only under the Analog dev server.

### 9. Credential size

`MAX_SIGNED_TOKEN_LENGTH = 8192` (in `looksLikeSignedToken` and `validateSession`, before any split,
decode or HMAC); the largest token Forge can now issue (254-char email, 256 lone surrogates as name) is
under 4,096. API keys: at most 128 characters after `<prefix>_` (issued: 80). Extraction is unchanged,
so Bearer keeps precedence over the cookie at any size and the CSRF check keeps seeing an oversized
Bearer as Bearer. Third-party adapters are untouched; `CompositeAuthAdapter` is unchanged.

### 10. Logging

`auth-handlers.ts` logs unexpected failures as `('Unexpected error in auth handler', { operation,
error: <class name> })`. In `handlers.ts`, an unexpected `requireAuth` failure is rethrown as
`AuthResolutionError` (message: the original class name only) before the generic `500` path logs it.
Expected failures are not logged.

### 11. First-party apps

- `devMode` explicit (above); demo `createRuntime(env, { devMode })` for its tests.
- `POST /api/auth/users`, `PUT /api/auth/users/:id`: admin check first (headers only), then
  `readJsonBody` (bounded, `413`/`400`), fields type-checked, `role` validated.
- tiny-project `POST /api/bootstrap-admin`: bounded body.
- login/signup routes use `toCancellableWebRequest`.

## Test plan

- `packages/auth/src/auth-bounds.test.ts` (32): secret matrix for both adapters (missing/dev/strong/
  weak/UTF-8 bytes, no echo), dev-secret token refused by production; policy validation, min/max
  boundaries with no PBKDF2 for rejects, no truncation, `updateUser` refuses before hashing/writing,
  lowered max on login; oversized login password (no lookup, no `importKey`); unknown vs wrong password
  (one derivation each, no writes, no `getRandomValues`), dummy hash format; email/name bounds; largest
  issued token; oversized signed token / API key (no HMAC / lookup / digest); demo login bound; cookie
  attributes, TTL alignment, `secure: false`.
- `packages/runtime/src/auth-abuse.test.ts` (23): body boundary (8191/8192/8193), 413 without adapter or
  throttle, `Content-Length` short-circuit (0 bytes pulled), lying/missing length (≤ bound + one chunk,
  cancelled), `maxBodyBytes` validation, malformed-input matrix (incl. `null`), oversized password → 401
  without PBKDF2; response parity; throttle optional / order / same arguments for four account cases /
  denial with no lookup / `Retry-After` matrix / fail-closed / signup and disabled signup / not called
  for logout, me, API-key writes; logging redaction (expected failures silent; unexpected → metadata;
  content-route `AuthResolutionError`); CSRF with malformed Authorization, oversized Bearer precedence,
  same-origin, cross-site logout via `Referer`; signup smuggling `role`, `roles`, `_sessionVersion`,
  `passwordHash`, `id`, `scopes`.
- `packages/angular/src/api.service.test.ts`: 413/429 keep `code`/`status`/message.
- `packages/cloudflare/test/workers/auth-throttle.test.ts` (workerd, local D1, Miniflare rate limiters,
  the documented recipe): one client → 3 then `429` + `Retry-After: 60`; many clients against one
  account → `429` on the 6th, identically for an unknown email; signup limited per client; 100,000-
  iteration PBKDF2. Miniflare's window is wall-clock, so each scenario starts inside one window;
  Forge's own throttle semantics are pinned clock-free by the runtime tests.
- `apps/tiny-project/e2e/golden-path.spec.ts` (+3): signup escalation after bootstrap (viewer, live
  session, 403 on users, submitted password works); 413 / 400 / login parity over HTTP; anonymous
  oversized admin POST → 401, admin → 413, 1025-character password → 400, cross-site logout → 403.

## Acceptance criteria

1. Every H04 acceptance item in the task list (bounded bodies, 413, bounded PBKDF2 input, no truncation,
   parity, dummy verification, one throttle hook before credential work and independent of account
   existence, deterministic 429, no Forge limiter, documented Cloudflare and portable wiring, no dev
   secret fallback, 32-byte secrets, bounded Forge tokens/keys, cookie attributes, CSRF, redacted logs,
   no signup escalation, machine auth and composite green, first-party apps compliant) has a test above.
2. `pnpm format:check`, `lint`, `typecheck`, `test`, `build`, `test:libsql`, `test:cloudflare`,
   `check:api`, `release:verify` and the three E2Es are green.

## Open questions

None.

## Outcome

Shipped as designed. Divergences found while implementing, all recorded above:

- Local workerd does not cap PBKDF2 iterations; the 1.0 decision rests on CPU cost.
- Nitro 2 buffers Cloudflare request bodies before routes run, so the stream cap's full effect needs a
  native-`Request` host; documented, not worked around.
- h3 1.15's Node body stream cannot be cancelled safely; the apps carry `toCancellableWebRequest`.
- A JSON `null` auth body was a `500`; now `400`.

**Review fixes** (forge-rules and spec reviewers): the documented throttle recipe keyed only on the
email allowed targeted lockout, so it now combines client and account buckets, and the workerd test
runs it verbatim. `toCancellableWebRequest` became pull-based, so an unread body is not buffered.
`maxBodyBytes` is validated outside the error mapping. `rest-api.md` lists 413/429. The 0.6 status
table records H03's missing browser/restart evidence rather than claiming it.

**Legacy rows.** Users stored before this spec with an email over 254 or a name over 256 characters
still log in. A name long enough to push the token past 8192 characters (thousands of characters)
would issue a session that is then refused; `updateUser(id, { name })` fixes it.

**Operational:** deployments whose `AUTH_SECRET` is missing or shorter than 32 bytes stop starting after
upgrading — including `apps/www` and `apps/demo-aesthetics` production if their secrets are unset or
short. Set a 32-byte-plus secret before deploying.

Roadmap 0.6 is complete with this spec. Next: roadmap 0.7 / M01 (not started here).
