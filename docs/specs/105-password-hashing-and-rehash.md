# 105 — Version password hashes and rehash on login

- **Status:** in-progress
- **Author:** agent draft (scope approved by the maintainer's 1.1.0 / V2-01 brief, 2026-11-17)
- **Date:** 2026-11-17
- **Branch:** `feat/admin-angular-22` (the single 1.1.0 PR, #127)
- **Affected packages/apps:** `@forge-cms/auth` (new option + two exports), `@forge-cms/cloudflare` (tests only), docs, `scripts/quality`
- **Release:** part of **1.1.0** (MINOR: one new option with an unchanged default, two new exports)

## Context / Why

`UsersCollectionAuthAdapter` hashes passwords with PBKDF2-HMAC-SHA256 at a fixed 100 000 iterations, stored unversioned as `base64url(salt‖hash)`. The work factor cannot be raised without locking every existing user out. OWASP currently recommends 600 000 for PBKDF2-HMAC-SHA256. The hard constraint is Cloudflare Workers CPU: every login (and every unknown-email login, spec 069) pays one derivation.

## Goal

The work factor can be raised at any time without locking anyone out: hashes carry their own parameters, older hashes keep verifying and are upgraded on the next successful login. Defaults are chosen from measured CPU cost, not raised silently.

## Measurements (2026-11-17)

`pnpm bench:password-hash` (new). One PBKDF2-HMAC-SHA256 derivation, median of 15, Apple M4, Wrangler 4.91.0 / local workerd (compat date 2026-01-01), Node 22.23.1. workerd cost = request time − empty-request time.

| Iterations          | local workerd | Node 22 | Workers Free (10 ms CPU) | Workers Paid (30 s default) |
| ------------------- | ------------- | ------- | ------------------------ | --------------------------- |
| 100 000 (1.0)       | 5.7 ms        | 7.5 ms  | fits locally             | fits                        |
| 310 000             | 18.5 ms       | 23.7 ms | no                       | fits                        |
| 600 000 (OWASP)     | 35.3 ms       | 45.5 ms | no                       | fits                        |
| 210 000 SHA-512     | 34.5 ms       | 35.6 ms | no                       | fits                        |
| 2 × 100 000 chained | 12.2 ms       | —       | no                       | fits                        |

Caveats:

- Cloudflare's edge CPUs are generally slower than an M4, so these are lower bounds. Even 100 000 may be close to 10 ms on the edge. The Free plan has some burst tolerance, but a login at the limit can fail with `Error 1102`.
- A login that upgrades a hash pays two derivations once.
- Local workerd accepted 600 000 iterations. Earlier production Workers releases rejected PBKDF2 above 100 000 iterations. This could not be verified against production here (no account access), so the docs tell Workers users to confirm on staging before raising above 100 000.

**Decision:** stronger defaults do not fit the Free plan. The default stays **100 000** (unchanged, documented, the `workers` preset), and the work factor becomes configurable with a documented **`node` preset of 600 000**. The Node quickstart uses it.

## Compatibility impact

**Backward compatible (MINOR).**

- New option `passwordHashing` with an unchanged default, plus new exports `PASSWORD_HASHING_PRESETS` and `PasswordHashingOptions`. `api-baseline/_forge-cms_auth.json` gains exactly these two.
- **At the default, nothing stored changes:** new hashes keep the 1.0 format, 1.0 hashes are never rewritten, no extra login work, and a rollback to 1.0 keeps every login working.
- Raising the work factor writes v2 hashes; rows upgraded that way are not verifiable by 1.0 (documented, one-way by design).
- No REST, envelope or session change. A rehash does not bump `_sessionVersion`.

## Non-goals

- No new algorithm (scrypt/Argon2 would need WASM or pure JS on Workers: more CPU, more bundle, a new dependency).
- No automatic per-profile detection: the adapter cannot know where it runs, so the profile is chosen in code.
- No forced re-hash of users who never log in.

## Design

```ts
export interface PasswordHashingOptions {
  /** PBKDF2-HMAC-SHA-256 iterations; default 100_000; integer in [100_000, 10_000_000]. */
  iterations?: number;
}
export const PASSWORD_HASHING_PRESETS: {
  readonly workers: { readonly iterations: 100_000 };
  readonly node: { readonly iterations: 600_000 };
};
// UsersCollectionAuthAdapterOptions gains: passwordHashing?: PasswordHashingOptions
```

Stored formats (`packages/auth/src/password-hash.ts`):

- **legacy:** `base64url(salt[16] ‖ hash[32])`, implicitly 100 000. Written when the configured work factor is 100 000.
- **v2:** `$pbkdf2-sha256$i=<n>$<b64url salt>$<b64url hash>`. Written otherwise.
- Anything else (wrong length, bad base64, out-of-range or non-canonical iterations, extra segments, other algorithms) never verifies.

Login:

1. Unchanged: oversized passwords are refused before any lookup.
2. Exactly one derivation. With no account, no hash or a malformed hash, it runs at the configured work factor against a fixed salt (no randomness on a failed login, spec 069) and fails.
3. Comparison with `timingSafeEqual`, which reads every byte.
4. On success, if the stored work factor is below the configured one, rehash and write it with `updateIf(…, { passwordHash }, { targetMatches: { passwordHash: old } })`. That is a compare-and-set, so a concurrent password change is never overwritten. A failed or lost write logs a warning without secrets and does not fail the login. Hashes are never downgraded.

## Implementation plan

- [x] `password-hash.ts` (formats, presets, validation, verify, rehash rule) + adapter wiring
- [x] exports + `api-baseline` (auth only)
- [x] tests: `password-hash.test.ts` (1.0 migration, rehash on login, sessions kept, wrong password, CAS, write failure, malformed, timing-safe compare, configuration), libSQL/InMemory parity, workerd + D1 (`@forge-cms/cloudflare`)
- [x] `pnpm bench:password-hash`
- [x] docs: REFERENCE, deployment (cost per profile), Node quickstart uses `PASSWORD_HASHING_PRESETS.node`
- [x] changeset (in the single 1.1.0 changeset), STATE.md

## Test plan

`pnpm --filter @forge-cms/auth test`, `pnpm --filter @forge-cms/cloudflare test:cloudflare`, `pnpm bench:password-hash`, `pnpm docs:verify`, `pnpm check:api`, full gates.

## Acceptance criteria

1. A hash in the exact 1.0 format verifies under both the default and a raised work factor.
2. With a raised work factor, a successful login upgrades the stored hash once, keeps `_sessionVersion` and the existing session valid, and the next login does not write.
3. A wrong password never writes. A concurrent password change survives the rehash. A failed rehash write does not fail the login.
4. The default writes the 1.0 format, and nothing changes for an install that does not opt in.
5. The same rehash passes on InMemory, libSQL and workerd + local D1.
6. Measurements recorded here, and the deployment docs state the default and the Node preset.

## Outcome

<!-- Fill when merged. -->
