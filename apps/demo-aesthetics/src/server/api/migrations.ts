import { defineMigration } from '@forge-cms/db';

/**
 * Reviewed migrations for the deployed demo database (spec 072 workflow). **Append-only**: never edit,
 * reorder or remove an entry that ran anywhere — the ledger checksums them. Run from
 * `scripts/remote-migrate.ts`, never from application startup.
 */
export const migrations = [
  // Spec 075. The production D1 predates `media.upload: true` gaining a Forge-managed `_storageKey`
  // column, and `syncSchema()` refuses to add it to a table that already has rows. Those 9 rows are
  // the seed's static images (`url: /images/*.svg`, no stored object); a fresh install seeds the very
  // same rows with `_storageKey` NULL (`seed.ts`), so adding the column without inventing keys leaves
  // production identical to a fresh install. Additive, nothing rewritten.
  defineMigration({
    id: '20260930_001_media_storage_key',
    description: 'Add media._storageKey; seeded static images keep no stored object (NULL)',
    destructive: false,
    statements: [{ sql: 'ALTER TABLE "media" ADD COLUMN "_storageKey" TEXT' }]
  }),

  // Spec 098. The shared public demo's global daily mutation budget (`demo-policy.ts`): one counter
  // row per mutation class per UTC day — `{ bucket: 'YYYY-MM-DD:CLASS', used }`, no IP, no user, no
  // payload. App operational state, not a Forge collection, so `syncSchema()` neither creates nor
  // owns it. Additive and idempotent; rollback is `DROP TABLE demo_budget` (the public demo then fails
  // closed: edits and bookings pause, browsing is unaffected).
  defineMigration({
    id: '20261015_001_demo_budget',
    description: 'Add demo_budget: the public demo daily mutation counters (operational, no PII)',
    destructive: false,
    statements: [
      {
        sql: 'CREATE TABLE IF NOT EXISTS "demo_budget" ("bucket" TEXT PRIMARY KEY NOT NULL, "used" INTEGER NOT NULL DEFAULT 0)'
      }
    ]
  })
];
