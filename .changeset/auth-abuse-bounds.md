---
'@forge-cms/auth': minor
'@forge-cms/runtime': minor
---

Bound authentication abuse and certify the auth surface (spec 069, roadmap 0.6 H04).

**Breaking for misconfigured deployments:** without `devMode: true`, `UsersCollectionAuthAdapter` and
`SignedTokenAuthAdapter` now refuse an `AUTH_SECRET` shorter than 32 bytes (UTF-8). A missing secret
never enables development mode: replace `devMode: !env.AUTH_SECRET` with an explicit development
signal (for Analog/Nitro, `import.meta.dev === true`). Generate a secret with `openssl rand -base64 48`.

- `@forge-cms/auth`: `PasswordPolicy.maxLength` (default 1024, at most 4096; the same string-length
  definition as `minLength`, validated at construction). Passwords outside the policy are refused
  before hashing on create, signup and `updateUser`; an over-long login password is
  `invalid-credentials` before any lookup. An unknown email now performs the same single PBKDF2
  verification as a wrong password (against a fixed dummy hash). Emails over 254 characters are
  `invalid-email`; names over 256 characters are the new `invalid-name` reason (also a
  `UserMutationError` reason, with `invalid-email`, for `updateUser`). Forge's own signed tokens over
  8192 characters and API keys over 128 characters after the prefix are refused before any decode,
  HMAC, hash or database lookup. `PasswordPolicy` and `UsersCollectionAuthAdapterOptions` are exported.
- `@forge-cms/runtime`: `handleLogin`/`handleSignup` read the body through the new
  `readBoundedJsonObject` (8 KiB by default, `maxBodyBytes` to change it; a stream cap, not just
  `Content-Length`) and answer `413 PAYLOAD_TOO_LARGE`. The optional `throttle` option
  (`AuthAttemptThrottle`) lets a host plug in its own limiter, called once per attempt before any
  credential work; a denial is `429 RATE_LIMITED` with an optional validated `Retry-After`. New
  `PayloadTooLargeError`, `RateLimitedError`, and `ForgeErrorCode` members `PAYLOAD_TOO_LARGE` and
  `RATE_LIMITED`. A JSON `null` auth body is now a `400` (it was a `500`). Unexpected auth failures are
  logged as `{ operation, error }` (the error's class name) only, never the error message.
