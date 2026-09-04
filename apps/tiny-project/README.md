# apps/tiny-project

A deliberately tiny, external-style ForgeCMS consumer — spec
[055](../../docs/specs/055-small-project-readiness-audit.md)'s readiness fixture.

**Not a showcase app.** Its only job is proving that a small real project — users, cookie auth,
protected admin, roles, drafts, one relation — works end to end from the published `@forge-cms/*`
surface, with no host CRUD pages and no repository-internal imports. See
[docs/small-project-guide.md](../www/src/content/docs/small-project-guide.md) for the walkthrough
this app's own code is the proof of.

Content model: `users` (`defineUsersCollection()`) + `posts` (`title`/`slug`/`body`/`author ->
users`, `drafts: true`, role-gated writes). Nothing else — no media, no second collection.

Unlike every other app in this repo, **this one seeds nothing**. First run means zero rows, zero
users — `POST /api/bootstrap-admin` (an app-local route, not a new Forge capability; see its own
doc comment) is how the very first admin gets created, at `/setup`.

## Commands

```bash
pnpm dev:tiny-project          # dev server at http://127.0.0.1:5175
pnpm test:tiny-project         # unit tests (InMemory adapters)
pnpm --filter @forge-cms/tiny-project test:libsql   # portable profile: real libSQL, no Cloudflare
pnpm test:cloudflare           # includes this app's real local D1 lifecycle proof
pnpm e2e:tiny-project          # full browser golden path (Playwright)
```

## Profiles proven here

- **Cloudflare**: `D1DatabaseAdapter` when `env.DB` exists (`wrangler.toml`), proven for real (not
  mocked) by `test/workers/d1-lifecycle.test.ts` via `@cloudflare/vitest-plugin`.
- **Portable**: `LibSqlDatabaseAdapter` with no Cloudflare binding of any kind, proven for real by
  `src/tests/portable-libsql.integration.test.ts`.

Both run the identical domain: schema sync, first-admin bootstrap, login, a second user, the full
post lifecycle (create/draft-hidden/publish/edit/delete), the author relation, and a role boundary
(editor may write, only admin may delete).
