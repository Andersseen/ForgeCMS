import { defineMigration } from '@forge-cms/db';

/**
 * Reviewed migrations for the official site's database (spec 072 workflow). **Append-only**: never
 * edit, reorder or remove an entry that ran anywhere — the ledger checksums them. Run from
 * `scripts/remote-migrate.ts`, never from application startup.
 */
export const migrations = [
  // Spec 075. The production D1 predates `posts.drafts: true`, and `syncSchema()` refuses to add
  // `_status` to a table with rows (they would silently vanish from anonymous reads). The seed wrote
  // its one post as published, so every existing row is marked published.
  defineMigration({
    id: '20260930_001_posts_status',
    description: 'Add posts._status and mark the existing posts published',
    destructive: false,
    statements: [
      { sql: 'ALTER TABLE "posts" ADD COLUMN "_status" TEXT' },
      { sql: 'UPDATE "posts" SET "_status" = ? WHERE "_status" IS NULL', args: ['published'] }
    ]
  })
];
