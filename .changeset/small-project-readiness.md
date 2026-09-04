---
'@forge-cms/core': patch
'@forge-cms/auth': patch
'@forge-cms/admin': minor
'@forge-cms/runtime': minor
---

fix: small-project readiness audit — passwordHash leak through populated relations, field ordering, Vite linker export, sign-up link (spec 055)

Found and fixed while building a deliberately tiny external-style ForgeCMS consumer
(`apps/tiny-project`, spec 055) whose whole point is a `post.author -> users` relation on
`defineUsersCollection()` — exactly the shape that exposed every one of these:

- **`@forge-cms/runtime`: `depth: 1` relation/upload population leaked every field of the related
  document, including one explicitly marked `access.read: []`** (e.g. `passwordHash` on any
  `defineUsersCollection()`/`withAuthFields()` collection) — `populateRecords`/`populateRecord`
  fetched the related row directly from the database adapter and embedded it as-is, never running it
  through `filterReadableFields`. Both now take an optional 4th `PopulateOptions` argument
  (`{ user?, overrideAccess? }`, new public export); when `overrideAccess: false` the populated
  document is filtered against _its own_ collection's field-level rules before being embedded, the
  same way the top-level document already is. `operations.ts`'s `find`/`findByID`/`findOne` and
  `handlers.ts`'s `handlePreview` now pass this through — every anonymous/restricted read that
  populates a relation is covered. A trusted Local API call (`overrideAccess` default `true`) is
  unaffected, matching every other operation's existing trust model. Both public function signatures
  are backward compatible — the new parameter is optional and defaults to today's behavior.
- **`@forge-cms/core`: `DocumentMeta`/`CollectionInput` gain an optional `_status?: 'draft' |
'published'`** — the typed Local API previously had no way to type-check setting or reading
  `_status` on a `drafts: true` collection (`defineCollection`'s current signature widens a literal
  `drafts: true` to `boolean`, so a conditional type keyed on it could never narrow), forcing an `as
Record<string, unknown>` cast for the single most basic draft/publish workflow. Additive; no runtime
  change.
- **`@forge-cms/auth`: `withAuthFields()` no longer puts `passwordHash` first in field order.** It
  used to spread `AUTH_USER_FIELDS` before the caller's own fields, so `passwordHash` was always the
  _first_ declared field on the merged collection — and `@forge-cms/admin`'s
  `ForgeRelationPickerComponent` searches whichever field comes first among `text`/`slug`/`email`
  kinds. A `relation({ collection: 'users' })` field silently searched by password hash instead of
  email. `passwordHash` now lands after every field the caller actually declared (still overridable —
  a caller that declares its own `passwordHash` keeps it, in whatever position they put it).
- **`@forge-cms/admin`: the Vite linker plugin is now a public export**, `@forge-cms/admin/vite`
  (`import { angularLinker } from '@forge-cms/admin/vite'`) — previously every consuming app had to
  hand-copy `vite-plugins/angular-linker.ts` from `apps/www` or hit a production-only `JIT compiler
unavailable` crash (DEMO-FINDINGS finding 13). `@angular/compiler-cli`, `@babel/core`, and `vite`
  are now optional peer dependencies (only needed if this subpath is actually imported — no warning
  for a consumer that doesn't use it). `apps/www` and `apps/demo-aesthetics` both dropped their local
  copy in favor of this export, proving it in place.
- **`@forge-cms/admin`: `forgeAdminAuthRoutes({ signup: true })`'s "Sign up" link now actually
  reaches `/signup`.** `ForgeSignInComponent`'s `[routerLink]` resolves relative to its own activated
  route (`login`); the unprefixed `signUpPath: 'signup'` data value appended as _login's own child_
  (`/admin/login/signup`, never a registered route — silently caught by the app's `**` wildcard and
  bounced to `/`) instead of reaching the sibling `signup` route. Now `'../signup'`.

No behavior change for any existing caller that doesn't pass the new `PopulateOptions` argument or
set `_status` — every existing test in the repo (914 unit tests across all packages/apps, the full
Playwright suites for `apps/www` and `apps/demo-aesthetics`, and `pnpm release:verify`'s packed
consumer checks) passes unmodified. See
[docs/specs/055-small-project-readiness-audit.md](../docs/specs/055-small-project-readiness-audit.md).
