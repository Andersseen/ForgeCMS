# @forge-cms/auth

## 0.1.0

### Minor Changes

- Add `SignedTokenAuthAdapter`, a real edge-compatible auth adapter (HS256-style signed tokens via Web Crypto only, no new dependency). Supports `login(email, password)` against one hardcoded demo user, `issueToken`, and the standard `AuthAdapter` contract (passes `runAuthAdapterContractTests`).
