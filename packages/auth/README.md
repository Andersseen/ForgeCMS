# @forge-cms/auth

Authentication for ForgeCMS: the `AuthAdapter` contract and the adapters that implement it.

**Who needs it:** every project with logged-in users or machine clients. **Boundary:** server only.

```sh
pnpm add @forge-cms/auth
```

```ts
import { UsersCollectionAuthAdapter, defineUsersCollection } from '@forge-cms/auth';

export const users = defineUsersCollection(); // email, name, role (admin | editor | viewer), password hash
const auth = new UsersCollectionAuthAdapter().init({
  AUTH_SECRET: env.AUTH_SECRET,
  userDatabase: database
});
```

## What it provides

- **`UsersCollectionAuthAdapter`** — users stored in your own database. PBKDF2 password hashing, signed 24-hour
  session tokens delivered as an `HttpOnly` `forge_session` cookie, the first user ever created is the admin,
  roles, a last-admin invariant, a password policy, login/signup throttling hooks, and session invalidation on password
  change or user deletion (the current user row is re-read on every request, so role changes apply immediately).
  The users collection it manages is not writable through the generic content API.
- **`ApiKeyAuthAdapter`** — scoped machine keys (`Authorization: Bearer forge_<id>_<secret>`); the secret is shown once and
  only a hash is stored.
- **`CompositeAuthAdapter`** — human and machine auth side by side.
- **`SignedTokenAuthAdapter`**, **`ExternalAuthAdapter`**, **`InMemoryAuthAdapter`** — token-only, delegated and test/dev adapters.
- Helpers: `hasRole`, `hasScope`, `isAdmin`, `canWriteContent`, `buildSessionCookie`, `buildLogoutCookie`, `withAuthFields`.

`AUTH_SECRET` (at least 32 bytes) is required in every production build; the dev secret needs an explicit `devMode: true`.
CSRF protection is enforced by the runtime handlers for cookie-authenticated mutations.

Reference: [docs/REFERENCE.md](../../docs/REFERENCE.md#forge-cmsauth) · guides: <https://forge-cms.pages.dev/docs/browser-auth> ·
<https://forge-cms.pages.dev/docs/machine-auth> · <https://forge-cms.pages.dev/docs/access-control>
