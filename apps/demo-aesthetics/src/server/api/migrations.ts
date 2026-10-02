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
  })
];
