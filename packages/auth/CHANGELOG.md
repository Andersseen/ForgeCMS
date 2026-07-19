# @forge-cms/auth

## 0.2.0

### Minor Changes

- 83f3b66: Normalize all package versions to 0.1.0 before the first npm publish.

## 0.1.0

### Minor Changes

- Add `SignedTokenAuthAdapter`, a real edge-compatible auth adapter (HS256-style signed tokens via Web Crypto only, no new dependency). Supports `login(email, password)` against one hardcoded demo user, `issueToken`, and the standard `AuthAdapter` contract (passes `runAuthAdapterContractTests`).
