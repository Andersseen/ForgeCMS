---
'@forge-cms/angular': minor
'@forge-cms/admin': minor
---

Configurable Angular transport and structured errors (spec 075, roadmap 0.8 C01 — the first npm `0.9.0` work).

- `@forge-cms/angular`: every option of `provideForgeCms()` is optional (defaults unchanged: same-origin `/api/v1` and `/api/auth`, cookie credentials). New `credentials`, `trustedOrigins` and `transport` options; cookies and the Bearer token are sent only to relative URLs, the page's origin and listed origins. One URL joiner; every collection slug, document id, user id and global slug is encoded as one path segment. Every method takes an optional last `{ signal }`. Every failure is a `ForgeApiError` (`kind`: `http` | `network` | `aborted` | `invalid-response`, plus `status`, `code`, `details`); `ApiValidationError`, `ApiAuthError` and `ApiAuthActionError` are now its subclasses. Nothing is retried.
- **Behavior changes:** `getCurrentUser()` resolves `null` only for a 401 and throws for a 403/5xx/network/malformed response, so `ForgeAuthSession` enters `'error'` instead of `'anonymous'` during an outage. A failed `ForgeAuthSession.logout()` keeps its error. An absolute base on another origin no longer receives credentials unless listed in `trustedOrigins`.
- `@forge-cms/admin`: `describeAdminError` reads the structured status/kind (network, 403, 404, 409, 413, 429, 5xx); new `describeSessionError`, used by the sign-in and sign-up forms so an outage is never shown as a credential problem.
