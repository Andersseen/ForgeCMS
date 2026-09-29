---
'@forge-cms/db': patch
'@forge-cms/cloudflare': patch
'@forge-cms/runtime': patch
'@forge-cms/testing': patch
---

Reviewed migrations (spec 072, roadmap 0.7 M02). You can now apply the changes `syncSchema()` refuses
(renames, backfills, enabling drafts, index replacements) as ordered, reviewed, declarative migrations:

```ts
import { defineMigration } from '@forge-cms/db';

const migrations = [
  defineMigration({
    id: '20260929_001_posts_headline_to_title',
    description: 'Rename posts.headline to title',
    destructive: true,
    statements: [{ sql: 'ALTER TABLE "posts" RENAME COLUMN "headline" TO "title"' }]
  })
];
const report = await runtime.runMigrations(migrations, { allowDestructive: true });
```

- Each migration commits as **one transaction** together with its entry in the new `_forge_migrations`
  ledger, on libSQL (`client.batch(…, 'write')`) and D1 (`batch()`). A migration that already ran is
  skipped, an edited one fails with `MIGRATION_CHECKSUM_MISMATCH`, and a reordered or removed one fails
  with `MIGRATION_HISTORY_MISMATCH` before anything runs. Two concurrent runners cannot both run the
  same position.
- Failures are typed (`MigrationError`) and truthful: rolled back and recorded as failed, applied
  (including after a lost response), or outcome unknown. A failed migration runs again only with
  `retryFailed`/`replaceFailed`; destructive ones need `allowDestructive`.
- `runtime.runMigrations()` reports `planSchema()` before and after, and runs the safe `syncSchema()`
  remainder. A post-flight problem is reported as committed, never as rolled back.
- `runtime.planMigrations()` and `runtime.readMigrationHistory()` give read-only preflight and history.
- `resetBaseline` replaces spec 070's manual `DELETE FROM "_forge_schema"` for semantic conversions.
- New optional `DatabaseAdapter.runMigrations?()`/`readMigrationHistory?()`, implemented by
  `LibSqlDatabaseAdapter` and `D1DatabaseAdapter`. Custom adapters keep compiling; InMemory reports
  `MIGRATION_UNSUPPORTED`.
- `@forge-cms/testing/contracts` adds `runMigrationContractTests`.

`syncSchema()` and `init()` are unchanged and never run migrations. There are no down migrations and
no CLI.
