# Backup, restore and upgrade recovery

How to back up a ForgeCMS installation, restore it into a clean environment, and decide between a
forward fix and a restore when an upgrade goes wrong. It complements
[SCHEMA-UPGRADES.md](SCHEMA-UPGRADES.md) (drift plans and reviewed migrations).

Everything marked **tested** is exercised by `pnpm test:upgrade` on every CI run (roadmap 0.7 M03,
[spec 073](specs/073-historical-upgrade-and-backup-restore-rehearsal.md)) against on-disk libSQL and
local D1/R2 (workerd). Commands marked **documented, not executed in CI** target real Cloudflare
resources; the test suite never touches a remote account.

## What a backup must contain

| Part                                       | Where it lives         | Included                                                                  |
| ------------------------------------------ | ---------------------- | ------------------------------------------------------------------------- |
| Content, users (password hashes), API keys | database               | yes — the whole database                                                  |
| History, globals, localized values         | database               | yes (`_versions_*`, `_global_*`, JSON per locale)                         |
| Schema baseline and migration ledger       | database               | yes (`_forge_schema`, `_forge_migrations`)                                |
| Pending storage cleanup                    | database               | yes (`_forge_storage_intents`)                                            |
| Uploaded files                             | object storage (R2, …) | **every object a document references** (`_storageKey`), with its metadata |

The file contract is: **every file the restored content needs is recoverable.** It is not a byte-for-
byte mirror of the bucket. Objects no document references (orphans, objects a pending intent is about
to delete) are not live content and are not required.

Never put secrets in a backup manifest: no `AUTH_SECRET`, passwords, API-key plaintext, cookies or
Cloudflare credentials. The database already holds only password hashes and API-key digests.

## The consistency boundary

**The database and the object storage do not share a transaction.** ForgeCMS has no online, atomic
snapshot across D1 and R2 (or libSQL and any object store), and no built-in maintenance mode. A
coherent backup therefore needs a quiet period that you, the operator, create:

```text
stop writes            (take the app offline, or disable its write routes)
snapshot the database
read the storage keys that snapshot references
copy exactly those objects (bytes, content type, custom metadata) and record SHA-256 + size
verify every copied object
resume writes
```

A backup restores to **the moment of the snapshot**. Anything written afterwards is not in it. This
runbook does not provide point-in-time recovery (see Cloudflare's Time Travel below for what the
provider offers).

## libSQL / local SQLite (tested)

1. **Quiesce.** Stop every process that writes to the file.
2. **Check the file is self-contained.** Forge's libSQL adapter uses SQLite's default rollback journal
   (`PRAGMA journal_mode` → `delete`). With no writer running there is no `<db>-journal`, `-wal` or
   `-shm` file next to it, and a byte copy is consistent. If the database was switched to WAL, run
   `PRAGMA wal_checkpoint(TRUNCATE);` after stopping writers, and only copy when no sidecar remains.
3. **Copy and checksum.**
   ```bash
   cp forge-cms.db backups/2026-09-29/database.sqlite
   shasum -a 256 forge-cms.db backups/2026-09-29/database.sqlite   # must be equal
   ```
4. **Restore to a different path**, never over the live file (`cp backup.sqlite restored.db`), verify
   the checksum, validate the application against it (below), then point `DATABASE_URL` at it.

Remote libSQL (Turso) has its own backup features; they are not exercised by this repository.

The portable profile has no durable object store until roadmap 0.10 (S3, P01–P03). The rehearsal runs
the same object backup code against `InMemoryStorageAdapter`; P03 extends it to S3.

## Cloudflare D1 (tested locally; remote commands documented, not executed in CI)

The official D1 path is `wrangler d1 export` and `wrangler d1 execute --file`
([Cloudflare docs](https://developers.cloudflare.com/d1/best-practices/import-export-data/)). A running
export blocks other requests to the database.

```bash
# 1. Quiesce writes, then export (documented, not executed in CI):
npx wrangler d1 export forge-cms-db --remote --output=./backup/database.sql
shasum -a 256 ./backup/database.sql > ./backup/database.sql.sha256

# 2. Restore into a NEW, empty database — never over the source:
npx wrangler d1 create forge-cms-db-restored
npx wrangler d1 execute forge-cms-db-restored --remote --file=./backup/database.sql

# 3. Verify (below), then switch the `DB` binding's database_id in wrangler.toml and redeploy.
```

The rehearsal runs exactly these commands with `--local` against two separate directories (source and
restored, each with its own `wrangler.jsonc` and state), after which the source is deleted, so the
restored environment cannot lean on it. The export contains no `BEGIN`/`COMMIT`, so it imports as is.

**Time Travel** (D1's point-in-time recovery: 30 days on Workers Paid, 7 on Free) restores a database
**in place** and is destructive for everything written after the chosen point. It is a provider
feature, useful for a mistake you notice quickly; ForgeCMS does not exercise it and this runbook does
not depend on it.

## R2 objects (tested locally; remote copy documented)

1. From the **database snapshot**, list the keys the content needs. With the exported SQL loaded into
   any SQLite (for example `sqlite3 snapshot.db < backup/database.sql`), for every upload-enabled
   collection:
   ```sql
   SELECT "_storageKey" FROM "media" WHERE "_storageKey" IS NOT NULL;
   ```
   Do **not** derive the list from `StorageAdapter.list()`: it has no pagination and the R2 adapter
   returns at most 1000 objects.
2. Copy each object with its bytes, `httpMetadata.contentType` and `customMetadata`, and record its
   SHA-256 and size. Name backup files by a hash of the key, never by the key (keys may contain `../`,
   slashes or Unicode). A key the snapshot references but the bucket does not have **fails the
   backup**. `wrangler r2 object get/put` (Wrangler 4.91) carry the content type but offer no custom
   metadata option, so use a small script over the R2 binding (or the S3-compatible API with a tool
   that preserves metadata):
   ```ts
   // Inside a Worker or a Miniflare script with both buckets bound (documented, not executed in CI).
   const object = await env.SOURCE_BUCKET.get(key);
   if (!object) throw new Error(`missing required object ${key}`);
   await env.RESTORED_BUCKET.put(key, await object.arrayBuffer(), {
     httpMetadata: object.httpMetadata,
     customMetadata: object.customMetadata
   });
   ```
3. Restore into a **new, empty bucket**, read every object back and compare SHA-256, content type and
   metadata before switching the `BUCKET` binding.

## Restore order and application verification (tested)

Keep the restored environment **offline** until both parts are back and verified:

```text
create an empty target environment (database + bucket)
restore the database
restore the required objects, verify their checksums
start ForgeCMS against the target — no traffic yet
verify (below)
switch bindings / DATABASE_URL, enable traffic
```

Verification uses only the public API:

```ts
import { formatSchemaPlan } from '@forge-cms/db';
import { migrations } from './migrations';

const runtime = createRuntime(restoredEnv).init(); // your usual factory, pointed at the target

const plan = await runtime.planSchema(); // the restored baseline: expect no changes
if (plan.blocking) throw new Error(formatSchemaPlan(plan));

console.table(await runtime.readMigrationHistory()); // must equal the history before the backup
const report = await runtime.runMigrations(migrations, { allowDestructive: true });
// every result is 'already-applied' — the ledger came back with the data, nothing runs twice

// usersAuth: the UsersCollectionAuthAdapter instance your factory created
const login = await usersAuth.login(adminEmail, adminPassword); // existing hashes still verify
await runtime.findByID({ collection: 'posts', id: someKnownId, depth: 1 }); // content + relations
// fetch a known file through your handleFile route and compare its bytes
const cleanup = await runtime.reconcileStorage(); // finishes intents that were pending at backup time
```

Then do one representative write before enabling traffic.

## Upgrading an old installation (tested from 0.4.0, 0.6.0 and 0.8.0)

1. Back up (above).
2. With the new code, **before** deploying it: `planSchema()` and read the blocking changes.
3. Write the reviewed migrations for them ([SCHEMA-UPGRADES](SCHEMA-UPGRADES.md#reviewed-migrations)).
4. Run `runtime.runMigrations(migrations, { allowDestructive: true })` from your deploy script. Its
   post-flight syncs the safe additive remainder (new internal tables and columns such as
   `_sessionVersion`, `_forge_storage_intents`, the version-history unique index) and records baselines.
5. Deploy the application.

Existing password hashes, API keys, ids, relations, drafts, localized values, globals, history
(including pre-0.6.0 patch-shaped versions) and files keep working; the rehearsal proves each one on
data written by those releases.

## Forward fix or restore?

| Situation                                                         | What to do                                                                                                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A migration failed and rolled back (`MIGRATION_EXECUTION_FAILED`) | Nothing committed. Fix the cause, then rerun with `retryFailed` or `replaceFailed` ([operator guide](SCHEMA-UPGRADES.md#when-a-migration-fails)). |
| A migration committed but was wrong                               | Write a **forward-fix** migration, or **restore a known-good backup** (and accept losing writes made after it).                                   |
| Post-flight failed (`MIGRATION_POSTFLIGHT_FAILED`)                | The migrations committed. Forward-fix (often a `resetBaseline`-only migration) or restore.                                                        |

**Deploying the previous JavaScript bundle does not roll the database back.** It runs old code against
new data. There are no down migrations.

## Limits

- No remote D1/R2 rehearsal: local evidence does not prove a remote Cloudflare configuration.
- No online, atomic database + object-storage snapshot; writes must be quiesced.
- No point-in-time recovery beyond the snapshot (Time Travel is a separate provider feature).
- No S3 yet (roadmap 0.10, P01–P03).
- An auth adapter backed by a **separate** database is neither migrated nor covered by this backup
  procedure; the tested profile keeps users on the runtime's database.
- `date` fields are stored and returned as ISO strings (DEMO-FINDINGS finding 24, roadmap 0.8 C02);
  a backup preserves exactly what is stored.

## Reproducing the evidence

```bash
pnpm build
pnpm test:upgrade
```

`pnpm fixtures:upgrade:generate <version>` regenerates a historical fixture from the published npm
packages (maintainer-only, needs network). It refuses to overwrite an existing fixture without
`--force`; fixtures are evidence and change only deliberately. See
[apps/upgrade-rehearsal/README.md](../apps/upgrade-rehearsal/README.md).
